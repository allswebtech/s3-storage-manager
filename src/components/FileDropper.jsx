import { CloudUpload, FileText, X, LoaderCircle, Check, Folder, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { toast } from 'react-toastify'
import MultiPartUpload from '../api/MultiPartUpload'
import headObjectExists from '../api/headObjectExists'
import { describeS3Error } from '../api/s3Client'
import useCredentials from '../hooks/useCredentials'
import { numberedKey, parentPrefix, toPrefix } from '../helpers/keys'
import { formatBytes } from '../helpers/format'

const MAX_KEEP_BOTH_ATTEMPTS = 1000
const ACTIVE = new Set(['pending', 'uploading', 'conflict'])

let idCounter = 0
function nextId() {
    idCounter += 1
    return `u${Date.now().toString(36)}-${idCounter}`
}

function relativePathOf(file) {
    return (file.webkitRelativePath || file.relativePath || file.name || '').replace(/^\/+/, '')
}

// Read all entries from a directory reader (readEntries returns at most ~100 entries per call).
async function readAllDirectoryEntries(directoryReader) {
    const entries = []
    for (;;) {
        const batch = await new Promise((resolve, reject) => directoryReader.readEntries(resolve, reject))
        if (!batch || batch.length === 0) break
        entries.push(...batch)
    }
    return entries
}

// Traverse a FileSystemEntry (file or directory) and collect File objects with their relative path.
async function traverseFileTree(entry, path = '') {
    if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej))
        // Synthetic relative path for dropped folders (webkitRelativePath is empty for drops).
        file.relativePath = `${path}${file.name}`
        return [file]
    }
    if (entry.isDirectory) {
        const entries = await readAllDirectoryEntries(entry.createReader())
        const nested = await Promise.all(entries.map((ent) => traverseFileTree(ent, `${path}${entry.name}/`)))
        return nested.flat()
    }
    return []
}

// Keys that already exist directly inside each parent prefix (one non-recursive listing per folder).
async function existingKeysIn(s3, bucket, parents) {
    const found = new Set()
    const failed = []
    const queue = [...parents]
    async function worker() {
        while (queue.length) {
            const prefix = queue.shift()
            try {
                let token
                do {
                    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, Delimiter: '/', ContinuationToken: token }))
                    for (const c of res.Contents || []) found.add(c.Key)
                    token = res.IsTruncated ? res.NextContinuationToken : undefined
                } while (token)
            } catch {
                failed.push(prefix)
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker))
    return { found, failed: new Set(failed) }
}

export default function FileDropper({ currentDirectory = '', uploading = false, setUploading, onUploaded }) {
    const [isDragging, setIsDragging] = useState(false)
    // Queue items: { id, file, relPath, targetKey, progress, status, error }
    // status: 'pending' | 'uploading' | 'done' | 'error' | 'canceled' | 'conflict' | 'skipped'
    const [files, setFiles] = useState([])
    const queueRef = useRef([])
    const controllersRef = useRef(new Map())
    const timersRef = useRef(new Set())
    const runningRef = useRef(false)
    const mountedRef = useRef(true)
    const { s3, credentials } = useCredentials()
    const bucket = credentials?.name

    const update = useCallback((fn) => {
        queueRef.current = fn(queueRef.current)
        setFiles(queueRef.current)
    }, [])

    const patch = useCallback((id, changes) => {
        update(q => q.map(it => (it.id === id ? { ...it, ...changes } : it)))
    }, [update])

    // Abort everything when the component goes away (e.g. switching to another bucket).
    useEffect(() => {
        mountedRef.current = true
        const controllers = controllersRef.current
        const timers = timersRef.current
        return () => {
            mountedRef.current = false
            controllers.forEach(c => c.abort())
            timers.forEach(t => clearTimeout(t))
        }
    }, [])

    async function runQueue() {
        if (runningRef.current || !s3 || !bucket) return
        runningRef.current = true
        setUploading?.(true)
        let uploadedAny = false
        try {
            for (;;) {
                if (!mountedRef.current) break
                const item = queueRef.current.find(f => f.status === 'pending')
                if (!item) break
                const controller = new AbortController()
                controllersRef.current.set(item.id, controller)
                patch(item.id, { status: 'uploading', progress: 0, error: '' })
                try {
                    await MultiPartUpload(s3, item.file, currentDirectory, bucket, {
                        onProgress: (uploaded, total) => {
                            patch(item.id, { progress: total ? Math.round((uploaded / total) * 100) : 100 })
                        },
                        signal: controller.signal,
                        concurrency: 4,
                        targetKey: item.targetKey,
                    })
                    uploadedAny = true
                    patch(item.id, { status: 'done', progress: 100 })
                    const t = setTimeout(() => {
                        timersRef.current.delete(t)
                        update(q => q.filter(p => p.id !== item.id))
                    }, 1500)
                    timersRef.current.add(t)
                } catch (err) {
                    const canceled = err?.name === 'AbortError'
                    patch(item.id, { status: canceled ? 'canceled' : 'error', error: canceled ? '' : describeS3Error(err) })
                } finally {
                    controllersRef.current.delete(item.id)
                }
            }
        } finally {
            runningRef.current = false
            if (mountedRef.current) {
                setUploading?.(false)
                if (uploadedAny) onUploaded?.()
            }
        }
    }

    // Add files: drop duplicates already queued, then check the bucket for existing objects.
    async function addFiles(fileList) {
        const dir = toPrefix(currentDirectory)
        const queuedKeys = new Set(queueRef.current.filter(i => ACTIVE.has(i.status)).map(i => i.targetKey))
        const unique = []
        let localSkipped = 0
        for (const file of fileList) {
            const relPath = relativePathOf(file)
            if (!relPath) continue
            const targetKey = dir + relPath
            if (queuedKeys.has(targetKey)) {
                localSkipped++
                continue
            }
            queuedKeys.add(targetKey)
            unique.push({ id: nextId(), file, relPath, targetKey, progress: 0, status: 'pending', error: '' })
        }
        if (localSkipped > 0) toast.warning(`${localSkipped} duplicate file(s) skipped (already in the queue)`, { autoClose: 3000 })
        if (!unique.length) return

        let existing = new Set()
        let unverified = new Set()
        if (s3 && bucket) {
            const parents = [...new Set(unique.map(u => parentPrefix(u.targetKey)))]
            const { found, failed } = await existingKeysIn(s3, bucket, parents)
            existing = found
            // Listing not allowed for some folders: fall back to per-file checks there.
            for (const u of unique) {
                if (!failed.has(parentPrefix(u.targetKey))) continue
                try {
                    if (await headObjectExists(s3, u.targetKey, bucket)) existing.add(u.targetKey)
                } catch {
                    unverified.add(u.targetKey)
                }
            }
        }

        const prepared = unique.map(u => {
            if (existing.has(u.targetKey)) return { ...u, status: 'conflict', error: 'Already exists' }
            if (unverified.has(u.targetKey)) return { ...u, status: 'conflict', error: 'Could not check whether it exists' }
            return u
        })
        // Newest additions on top
        update(q => [...prepared, ...q])
        runQueue()
    }

    async function pickAvailableKey(startKey) {
        const taken = new Set(queueRef.current.filter(i => ACTIVE.has(i.status)).map(i => i.targetKey))
        for (let n = 1; n <= MAX_KEEP_BOTH_ATTEMPTS; n++) {
            const candidate = numberedKey(startKey, n)
            if (taken.has(candidate)) continue
            if (!(await headObjectExists(s3, candidate, bucket))) return candidate
        }
        throw new Error('Could not find a free name')
    }

    async function keepBoth(item) {
        try {
            const freeKey = await pickAvailableKey(item.targetKey)
            patch(item.id, { status: 'pending', progress: 0, error: '', targetKey: freeKey })
            runQueue()
        } catch (err) {
            patch(item.id, { error: describeS3Error(err) })
            toast.error(`Keep both failed: ${describeS3Error(err)}`)
        }
    }

    function requeue(id, changes = {}) {
        patch(id, { status: 'pending', progress: 0, error: '', ...changes })
        runQueue()
    }

    function replaceAllConflicts() {
        update(q => q.map(p => (p.status === 'conflict' ? { ...p, status: 'pending', progress: 0, error: '' } : p)))
        runQueue()
    }

    function skipAllConflicts() {
        update(q => q.map(p => (p.status === 'conflict' ? { ...p, status: 'skipped', error: '' } : p)))
    }

    function cancelItem(id) {
        controllersRef.current.get(id)?.abort()
        patch(id, { status: 'canceled' })
    }

    function cancelAllUploads() {
        controllersRef.current.forEach(c => c.abort())
        update(q => q.map(p => (p.status === 'pending' || p.status === 'uploading' ? { ...p, status: 'canceled' } : p)))
    }

    function clearAll() {
        cancelAllUploads()
        update(() => [])
    }

    async function handleDrop(e) {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
        const { items, files: dtFiles } = e.dataTransfer
        try {
            const supportsEntries = items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function'
            if (supportsEntries) {
                const entries = Array.from(items)
                    .filter((it) => it.kind === 'file')
                    .map((it) => it.webkitGetAsEntry())
                    .filter(Boolean)
                const collected = await Promise.all(entries.map((entry) => traverseFileTree(entry)))
                await addFiles(collected.flat())
            } else {
                await addFiles(Array.from(dtFiles || []))
            }
        } catch (err) {
            toast.error(`Could not read the dropped files: ${err?.message || err}`)
        }
    }

    async function handleFileInput(e) {
        const selected = Array.from(e.target.files || [])
        // Clear the input so selecting the same file again fires another change event.
        e.target.value = ''
        try {
            await addFiles(selected)
        } catch (err) {
            toast.error(`Could not add files: ${describeS3Error(err)}`)
        }
    }

    const stop = (e) => {
        e.preventDefault()
        e.stopPropagation()
    }

    const borderColor = isDragging ? 'border-[#3a3a3a] bg-[#171717]' : 'border-[#252525] bg-[#101010]'
    const conflictCount = files.filter(f => f.status === 'conflict').length

    const statusLabel = (it) => ({
        uploading: `${it.progress}%`,
        done: 'Done',
        error: 'Error',
        canceled: 'Canceled',
        skipped: 'Skipped',
        conflict: 'Conflict',
    }[it.status] || 'Pending')

    // group files by top-level folder for a friendly view
    const groups = new Map()
    files.forEach(it => {
        const parts = it.relPath.split('/').filter(Boolean)
        const group = parts.length > 1 ? parts[0] : '_root'
        const displayName = parts.length > 1 ? parts.slice(1).join('/') : it.relPath
        if (!groups.has(group)) groups.set(group, [])
        groups.get(group).push({ ...it, displayName })
    })

    return (
        <div
            data-testid='file-dropper'
            className={`w-full p-6 border-2 border-dashed rounded-lg transition-colors ${borderColor}`}
            onDragEnter={(e) => { stop(e); setIsDragging(true) }}
            onDragLeave={(e) => { stop(e); setIsDragging(false) }}
            onDragOver={stop}
            onDrop={handleDrop}
        >
            <div className='flex flex-col items-center justify-center space-y-4'>
                <CloudUpload size={50} className='stroke-[1.5] text-gray-500' aria-hidden='true' />

                <div className='text-center'>
                    <p className='font-mono text-sm text-gray-400'>
                        {uploading
                            ? 'Uploading...'
                            : isDragging
                                ? 'Drop files here'
                                : 'Drag & drop files here, or click to select'}
                    </p>
                    <p className='font-mono text-xs text-gray-600 mt-1'>
                        Supports multiple files and folders
                    </p>
                </div>

                <div className='flex items-center gap-2 flex-wrap justify-center'>
                    <label className='btn btn-ghost cursor-pointer'>
                        <input
                            type='file'
                            className='hidden'
                            multiple
                            onChange={handleFileInput}
                            disabled={uploading}
                            data-testid='file-input'
                        />
                        Select Files
                    </label>
                    <label className='btn btn-ghost cursor-pointer'>
                        <input
                            type='file'
                            className='hidden'
                            multiple
                            onChange={handleFileInput}
                            disabled={uploading}
                            webkitdirectory=''
                            mozdirectory=''
                            directory=''
                            data-testid='folder-input'
                        />
                        Select Folder
                    </label>
                </div>
            </div>

            {files.length > 0 && (
                <div className='mt-6 space-y-2'>
                    {conflictCount > 0 && (
                        <div role='status' className='bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 mb-4 flex items-center gap-3'>
                            <div className='p-2 bg-yellow-500/20 rounded-lg'>
                                <TriangleAlert className='w-5 h-5 text-yellow-500' aria-hidden='true' />
                            </div>
                            <div>
                                <h4 className='text-sm font-medium text-yellow-200'>
                                    Upload Conflicts
                                </h4>
                                <p className='text-xs text-yellow-500/80 mt-0.5'>
                                    {conflictCount === 1 ? '1 file already exists in this folder' : `${conflictCount} files already exist in this folder`}
                                </p>
                            </div>
                        </div>
                    )}

                    <div className='flex items-center justify-between gap-2 flex-wrap'>
                        <div>
                            <h5 className='font-mono text-sm text-gray-200'>Upload queue</h5>
                            <div className='font-mono text-xs text-gray-400'>{`${files.filter(f => f.status === 'done').length}/${files.length} files uploaded`}</div>
                        </div>
                        <div className='flex items-center gap-2 flex-wrap'>
                            <button type='button' onClick={clearAll} className='btn btn-ghost'>Clear</button>
                            <button type='button' onClick={replaceAllConflicts} className='btn btn-ghost' disabled={!conflictCount}>Replace All</button>
                            <button type='button' onClick={skipAllConflicts} className='btn btn-ghost' disabled={!conflictCount}>Skip All</button>
                            <button type='button' onClick={() => update(q => q.filter(p => p.status !== 'skipped' && p.status !== 'conflict'))} className='btn btn-ghost'>Clear Skipped/Conflicts</button>
                            {uploading ? (
                                <button type='button' onClick={cancelAllUploads} className='btn btn-ghost text-red-400'>Cancel All</button>
                            ) : (
                                <button type='button' onClick={runQueue} className='btn btn-primary'>Upload Now</button>
                            )}
                        </div>
                    </div>

                    <div className='space-y-2 max-h-56 overflow-y-auto'>
                        {Array.from(groups.entries()).map(([groupName, items]) => (
                            <div key={groupName} className='mb-2 border-b border-[#151515] pb-2'>
                                {groupName !== '_root' && (
                                    <div className='flex items-center gap-2 font-mono text-sm text-gray-300 mb-2'>
                                        <Folder size={16} className='text-yellow-400' aria-hidden='true' />
                                        <span>{groupName}</span>
                                        <span className='text-xs text-gray-500'>{`(${items.length})`}</span>
                                    </div>
                                )}
                                {items.map((it) => (
                                    <div
                                        key={it.id}
                                        data-testid='upload-item'
                                        data-status={it.status}
                                        data-name={it.relPath}
                                        className={`flex items-center justify-between p-2 rounded-md ${it.status === 'uploading' ? 'bg-green-900 border border-green-600' : 'card'}`}
                                    >
                                        <div className='flex items-center space-x-2 w-full min-w-0'>
                                            <FileText size={16} className='text-gray-500' aria-hidden='true' />
                                            <div className='flex-1 min-w-0'>
                                                <div className='flex items-center justify-between'>
                                                    <span className='font-mono text-xs text-gray-300 truncate max-w-[50vw] sm:max-w-xs' title={it.targetKey}>
                                                        {it.displayName}
                                                    </span>
                                                    <div className='flex items-center gap-2'>
                                                        <span className='font-mono text-xs text-gray-400 ml-2'>{formatBytes(it.file.size)}</span>
                                                        <span className='font-mono text-xs text-gray-400 ml-2'>{statusLabel(it)}</span>
                                                        {it.status === 'done' && <Check size={14} className='text-green-400' aria-hidden='true' />}
                                                        {it.status === 'uploading' && <LoaderCircle size={14} className='animate-spin text-yellow-400' aria-hidden='true' />}
                                                        {(it.status === 'error' || it.status === 'canceled') && <X size={14} className='text-red-400' aria-hidden='true' />}
                                                    </div>
                                                </div>
                                                {it.error && (
                                                    <div className={`font-mono text-[11px] mt-1 break-words ${it.status === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>{it.error}</div>
                                                )}
                                                <div className='h-1 bg-[#111] rounded mt-2 overflow-hidden'>
                                                    <div style={{ width: `${it.progress}%` }} className='h-1 bg-green-500 transition-all' />
                                                </div>
                                            </div>
                                        </div>

                                        <div className='ml-3 flex items-center gap-2'>
                                            {it.status === 'uploading' && (
                                                <button type='button' onClick={() => cancelItem(it.id)} className='btn btn-ghost'>Cancel</button>
                                            )}
                                            {(it.status === 'error' || it.status === 'canceled') && (
                                                <button type='button' onClick={() => requeue(it.id)} className='btn btn-ghost'>Retry</button>
                                            )}
                                            {it.status !== 'uploading' && it.status !== 'done' && it.status !== 'skipped' && it.status !== 'conflict' && (
                                                <button type='button' aria-label={`Remove ${it.relPath} from the queue`} onClick={() => update(q => q.filter(f => f.id !== it.id))} className='text-gray-500 hover:text-gray-300'>
                                                    <X size={16} className='text-gray-500 cursor-pointer' aria-hidden='true' />
                                                </button>
                                            )}
                                            {it.status === 'skipped' && (
                                                <div className='flex items-center gap-2'>
                                                    <span className='text-xs text-yellow-300 font-mono'>Skipped</span>
                                                    <button type='button' onClick={() => requeue(it.id)} className='btn btn-ghost'>Upload anyway</button>
                                                </div>
                                            )}
                                            {it.status === 'conflict' && (
                                                <div className='flex items-center gap-2'>
                                                    <span className='text-xs text-yellow-300 font-mono'>Conflict</span>
                                                    <button type='button' onClick={() => requeue(it.id)} className='btn btn-ghost'>Replace</button>
                                                    <button type='button' onClick={() => patch(it.id, { status: 'skipped', error: '' })} className='btn btn-ghost'>Skip</button>
                                                    <button type='button' onClick={() => keepBoth(it)} className='btn btn-ghost'>Keep Both</button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
