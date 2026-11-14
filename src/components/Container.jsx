import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import { Database, House, LoaderCircle } from 'lucide-react'

import FileDropper from './FileDropper'
import Finder from './Finder'
import listFiles from '../api/listFiles'
import CreateFolderModal from './modals/CreateFolderModal'
import InfoModal from './modals/InfoModal'
import PreviewModal from './modals/PreviewModal'
import RenameModal from './modals/RenameModal'
import MoveCopyModal from './modals/MoveCopyModal'
import BulkDeleteModal from './modals/BulkDeleteModal'
import useCredentials from '../hooks/useCredentials'
import renameFile from '../api/renameFile'
import renameFolder from '../api/renameFolder'
import searchFilesAndFolders from '../api/searchFilesAndFolders'
import getFilePreview from '../api/getFilePreview'
import { describeS3Error } from '../api/s3Client'
import filterFilesByType from '../helpers/filterFilesByType'
import { credentialId, loadDirectory, saveDirectory } from '../helpers/credentials'
import { parentPrefix, toPrefix, toUiPath } from '../helpers/keys'
import { openInNewTab } from '../helpers/url'
import useDebounce from '../hooks/useDebounce'

const EMPTY_SET = new Set()
const EMPTY_LISTING = { key: null, items: [], token: null, hasMore: false, hasPaged: false, error: '' }

export default function Container() {
    const { s3, credentials } = useCredentials()
    const [searchParams, setSearchParams] = useSearchParams()
    const location = useLocation()
    const bucket = credentials?.name
    const credId = credentialId(credentials)
    // The folder lives in the URL (?path=...), so browser Back/Forward and reload follow folder navigation.
    // History entries remember which bucket they belong to; an entry of another bucket (e.g. Back after
    // switching credentials) is not applied to this one.
    const stateCred = location.state?.cred
    const rawPath = searchParams.get('path')
    const pathParam = rawPath != null && (stateCred == null || stateCred === credId) ? rawPath : null
    const currentDirectory = toPrefix(pathParam ?? '')

    const [refreshFlag, setRefreshFlag] = useState(0)
    const [listing, setListing] = useState(EMPTY_LISTING)
    const [loadingMore, setLoadingMore] = useState(false)
    const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [renameTarget, setRenameTarget] = useState(null)
    const [moveCopy, setMoveCopy] = useState(null) // { mode, items }
    const [searchTerm, setSearchTerm] = useState('')
    const debouncedSearchTerm = useDebounce(searchTerm.trim(), 400)
    const [filterType, setFilterType] = useState('all')
    const [infoItem, setInfoItem] = useState(null)
    const [previewItem, setPreviewItem] = useState(null)
    // Selection belongs to one folder of one bucket; navigating elsewhere drops it implicitly.
    const [selection, setSelection] = useState({ scope: '', keys: EMPTY_SET })
    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
    const [downloading, setDownloading] = useState(false)
    const requestSeq = useRef(0)

    const isSearchMode = Boolean(debouncedSearchTerm) || filterType !== 'all'
    const queryKey = JSON.stringify([credId, currentDirectory, debouncedSearchTerm, filterType, refreshFlag])
    const loading = listing.key !== queryKey
    const files = useMemo(() => (loading ? [] : listing.items), [loading, listing.items])

    const selectionScope = `${credId}|${currentDirectory}`
    const selectedKeys = selection.scope === selectionScope ? selection.keys : EMPTY_SET
    // Only items that are currently listed count as selected (search/filter/refresh can hide some).
    const selectedItems = useMemo(() => files.filter(f => selectedKeys.has(f.key)), [files, selectedKeys])
    const visibleSelectedKeys = useMemo(() => new Set(selectedItems.map(f => f.key)), [selectedItems])

    function setSelectedKeys(updater) {
        setSelection(prev => {
            const base = prev.scope === selectionScope ? prev.keys : EMPTY_SET
            const next = typeof updater === 'function' ? updater(base) : updater
            return { scope: selectionScope, keys: next }
        })
    }

    function refresh() {
        setRefreshFlag(f => f + 1)
    }

    function navigateTo(path) {
        const prefix = toPrefix(path)
        if (prefix === currentDirectory && pathParam != null) return
        setSearchParams({ path: toUiPath(prefix) }, { state: { cred: credId } })
    }

    // Remember the folder per bucket (restored on the next visit or after switching back).
    useEffect(() => {
        if (credentials && pathParam != null) saveDirectory(credentials, currentDirectory)
    }, [credentials, currentDirectory, pathParam])

    // Load the first page whenever the folder, bucket, search or filter changes.
    useEffect(() => {
        if (!credentials || !s3 || pathParam == null) return undefined
        const seq = ++requestSeq.current
        const controller = new AbortController()
        const key = queryKey
        async function load() {
            try {
                let next
                if (isSearchMode) {
                    let items = await searchFilesAndFolders(s3, currentDirectory, debouncedSearchTerm, bucket, { signal: controller.signal })
                    if (filterType !== 'all') items = filterFilesByType(items, filterType)
                    next = { key, items, token: null, hasMore: false, hasPaged: false, error: '' }
                } else {
                    const res = await listFiles(s3, currentDirectory, bucket, { signal: controller.signal })
                    next = { key, items: res.items, token: res.nextContinuationToken, hasMore: res.isTruncated, hasPaged: false, error: '' }
                }
                if (seq === requestSeq.current) setListing(next)
            } catch (err) {
                if (controller.signal.aborted || seq !== requestSeq.current) return
                const message = describeS3Error(err)
                toast.error(`Could not list files: ${message}`, { toastId: `list-error-${key}` })
                setListing({ ...EMPTY_LISTING, key, error: message })
            }
        }
        load()
        return () => controller.abort()
    }, [s3, credentials, bucket, currentDirectory, debouncedSearchTerm, filterType, isSearchMode, pathParam, queryKey])

    async function loadMore() {
        if (!credentials || !s3 || !listing.hasMore || !listing.token || loadingMore) return
        const key = listing.key
        setLoadingMore(true)
        try {
            const res = await listFiles(s3, currentDirectory, bucket, { continuationToken: listing.token })
            setListing(prev => (prev.key !== key ? prev : {
                ...prev,
                items: [...prev.items, ...res.items.filter(i => !prev.items.some(p => p.key === i.key))],
                token: res.nextContinuationToken,
                hasMore: res.isTruncated,
                hasPaged: true,
            }))
        } catch (err) {
            toast.error(`Could not load more: ${describeS3Error(err)}`)
        } finally {
            setLoadingMore(false)
        }
    }

    async function handleDownloadSelection() {
        if (downloading || !selectedItems.length) return
        setDownloading(true)
        try {
            if (selectedItems.length === 1 && selectedItems[0].type === 'file') {
                const url = await getFilePreview(s3, selectedItems[0].key, true, bucket, credentials.publicUrl)
                openInNewTab(url)
            } else {
                const { default: downloadSelectionAsZip } = await import('../api/downloadSelectionAsZip')
                await downloadSelectionAsZip(s3, selectedItems, bucket, currentDirectory)
            }
        } catch (err) {
            toast.error(`Download failed: ${err?.name === 'ZipTooLargeError' ? err.message : describeS3Error(err)}`, { autoClose: 10000 })
        } finally {
            setDownloading(false)
        }
    }

    async function handleDownloadFolder(item) {
        if (!item || downloading) return
        setDownloading(true)
        try {
            const { default: downloadSelectionAsZip } = await import('../api/downloadSelectionAsZip')
            await downloadSelectionAsZip(s3, [item], bucket, currentDirectory)
        } catch (err) {
            toast.error(`Download failed: ${err?.name === 'ZipTooLargeError' ? err.message : describeS3Error(err)}`, { autoClose: 10000 })
        } finally {
            setDownloading(false)
        }
    }

    // Throws to the modal (it shows the reason); closes it and refreshes on success.
    async function handleRename(newName) {
        const item = renameTarget
        if (!item) return
        const parent = parentPrefix(item.key)
        if (item.type === 'folder') await renameFolder(s3, item.key, `${parent}${newName}/`, bucket)
        else await renameFile(s3, item.key, `${parent}${newName}`, bucket)
        toast.success(`Renamed to ${newName}`)
        setRenameTarget(null)
        refresh()
    }

    function toggleSelect(item) {
        setSelectedKeys(prev => {
            const next = new Set(prev)
            if (next.has(item.key)) next.delete(item.key)
            else next.add(item.key)
            return next
        })
    }

    // No folder in the URL yet (first visit, or coming back from another page): restore the
    // last folder of this bucket without adding a history entry.
    if (credentials && pathParam == null) {
        const restored = loadDirectory(credentials)
        return <Navigate replace to={{ search: `?${new URLSearchParams({ path: toUiPath(restored) })}` }} state={{ cred: credId }} />
    }

    const breadcrumbParts = currentDirectory.split('/').filter(Boolean)

    return (
        <>
        <div className='w-full px-2 sm:px-4 py-4 pb-24'>
            <div className='w-full max-w-6xl mx-auto card divide-y divide-[#252525]'>
                <div className='w-full p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'>
                    <h4 className='font-mono text-sm text-gray-300 select-none flex items-center gap-2'><Database size={15} className='text-orange-300 shrink-0' aria-hidden='true' />{credentials?.name || 'No Credential'}</h4>
                    <div className='flex items-center gap-2 flex-wrap'>
                        <input
                            type='search'
                            aria-label='Search files and folders'
                            placeholder='Search files/folders'
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className='input text-xs mr-0 sm:mr-2 w-full sm:w-auto'
                        />
                        <select
                            aria-label='Filter by file type'
                            value={filterType}
                            onChange={e => setFilterType(e.target.value)}
                            className='file-type-select input text-xs mr-0 sm:mr-2 w-full sm:w-auto'
                        >
                            <option value='all'>All Files</option>
                            <option value='image'>Images</option>
                            <option value='video'>Videos</option>
                            <option value='audio'>Audio</option>
                            <option value='document'>Documents</option>
                            <option value='code'>Code</option>
                            <option value='archive'>Archives</option>
                            <option value='other'>Other</option>
                        </select>
                        {currentDirectory !== '' &&
                            <button type='button' onClick={() => navigateTo(parentPrefix(currentDirectory))} className='btn btn-ghost'>Back</button>
                        }
                        <button type='button' onClick={() => setIsCreateFolderModalOpen(true)} className='btn btn-primary'>Add Folder</button>
                    </div>
                </div>
                {/* Drag & Drop above path */}
                <div className='p-4 bg-[#101010]'>
                    <FileDropper
                        key={credId}
                        currentDirectory={currentDirectory}
                        uploading={uploading}
                        setUploading={setUploading}
                        onUploaded={refresh}
                    />
                </div>
                {/* Breadcrumbs */}
                <nav aria-label='Folder path' className='w-full px-3 sm:px-4 py-2 bg-[#0f0f0f] border-t border-b border-[#202020]'>
                    <div className='font-mono text-[12px] text-gray-400 select-none flex items-center gap-1'>
                        <span className='flex items-center flex-wrap gap-1 break-words'>
                            <span>
                                <button type='button' aria-label='Go to bucket root' onClick={() => navigateTo('')} className='inline align-middle text-blue-400 cursor-pointer hover:underline mr-1'>
                                    <House size={14} aria-hidden='true' />
                                </button>
                                {breadcrumbParts.length > 0 && <span className='text-gray-500'>/</span>}
                            </span>
                            {breadcrumbParts.map((part, idx) => {
                                const prefix = breadcrumbParts.slice(0, idx + 1).join('/') + '/'
                                return (
                                    <span key={prefix}>
                                        <button
                                            type='button'
                                            className='text-blue-400 cursor-pointer hover:underline'
                                            aria-current={idx === breadcrumbParts.length - 1 ? 'page' : undefined}
                                            onClick={() => navigateTo(prefix)}
                                        >
                                            {part}
                                        </button>
                                        {idx < breadcrumbParts.length - 1 && <span className='text-gray-500'>/</span>}
                                    </span>
                                )
                            })}
                        </span>
                    </div>
                </nav>
                {selectedItems.length > 0 && (
                    <div className='w-full p-3 bg-[#0e0e0e] border-t border-b border-[#202020] flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between'>
                        <div className='text-xs font-mono text-gray-300'>
                            {selectedItems.length} selected
                        </div>
                        <div className='flex items-center gap-2 flex-wrap'>
                            <button type='button' className='btn btn-ghost' onClick={() => setMoveCopy({ mode: 'copy', items: selectedItems })}>Copy</button>
                            <button type='button' className='btn btn-ghost' onClick={() => setMoveCopy({ mode: 'move', items: selectedItems })}>Move</button>
                            <button
                                type='button'
                                className='btn btn-ghost'
                                disabled={downloading}
                                onClick={handleDownloadSelection}
                            >
                                {downloading ? (
                                    <span className='inline-flex items-center gap-2'>
                                        <LoaderCircle size={14} className='animate-spin text-yellow-400' />
                                        Preparing…
                                    </span>
                                ) : (
                                    'Download'
                                )}
                            </button>
                            <button type='button' className='btn btn-danger' onClick={() => setBulkDeleteOpen(true)}>Delete</button>
                            <button type='button' className='btn btn-ghost' onClick={() => setSelectedKeys(EMPTY_SET)}>Clear</button>
                        </div>
                    </div>
                )}
                <div className='bg-[#101010] rounded-b-xl'>
                    <div>
                        {listing.error && !loading ? (
                            <div role='alert' className='flex flex-col items-center justify-center gap-3 py-10 text-sm font-mono'>
                                <span className='text-red-400 text-center px-4 break-words'>Could not load this folder: {listing.error}</span>
                                <button type='button' className='btn btn-ghost' onClick={refresh}>Retry</button>
                            </div>
                        ) : (
                            <Finder
                                contents={files}
                                currentDirectory={currentDirectory}
                                loading={loading}
                                setCurrentDirectory={navigateTo}
                                showItemPath={isSearchMode}
                                onPreview={setPreviewItem}
                                selectedKeys={visibleSelectedKeys}
                                onToggleSelect={toggleSelect}
                                onToggleSelectAll={() => {
                                    const allSelected = files.length > 0 && files.every(f => visibleSelectedKeys.has(f.key))
                                    setSelectedKeys(allSelected ? EMPTY_SET : new Set(files.map(f => f.key)))
                                }}
                                onRename={setRenameTarget}
                                onDelete={refresh}
                                onOpenInfo={setInfoItem}
                                onCopy={(item) => setMoveCopy({ mode: 'copy', items: [item] })}
                                onMove={(item) => setMoveCopy({ mode: 'move', items: [item] })}
                                onDownloadFolder={handleDownloadFolder}
                                onSelectFromContext={toggleSelect}
                            />
                        )}
                        {!isSearchMode && !loading && !listing.error && (
                            <div className='p-4 flex items-center justify-center text-sm'>
                                {listing.hasMore && (
                                    <button type='button' disabled={loadingMore} onClick={loadMore} className='btn btn-ghost'>
                                        {loadingMore ? 'Loading…' : 'Load more'}
                                    </button>
                                )}
                                {!listing.hasMore && listing.hasPaged && (
                                    <span className='text-gray-500'>No more items</span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {/* Modals */}
            <CreateFolderModal
                isOpen={isCreateFolderModalOpen}
                handleClose={() => setIsCreateFolderModalOpen(false)}
                currentDirectory={currentDirectory}
                onCreated={refresh}
            />
            <RenameModal
                isOpen={renameTarget != null}
                handleClose={() => setRenameTarget(null)}
                item={renameTarget}
                onRename={handleRename}
            />
            <MoveCopyModal
                isOpen={moveCopy != null}
                onClose={() => setMoveCopy(null)}
                items={moveCopy?.items}
                mode={moveCopy?.mode}
                currentDirectory={currentDirectory}
                onDone={(changed) => {
                    if (changed) {
                        setSelectedKeys(EMPTY_SET)
                        refresh()
                    }
                }}
            />
            {/* Bulk Delete */}
            <BulkDeleteModal
                isOpen={bulkDeleteOpen}
                onClose={() => setBulkDeleteOpen(false)}
                items={selectedItems}
                onDone={({ failed }) => {
                    setBulkDeleteOpen(false)
                    setSelectedKeys(new Set(failed))
                    refresh()
                }}
            />
            <InfoModal
                isOpen={infoItem != null}
                onClose={() => setInfoItem(null)}
                item={infoItem}
            />
            <PreviewModal
                isOpen={previewItem != null}
                onClose={() => setPreviewItem(null)}
                onSaved={refresh}
                item={previewItem}
            />
    </div>
    {downloading && (
            <div role='status' className='fixed bottom-4 right-4 bg-[#181818] border border-[#232323] shadow-lg rounded-md px-3 py-2 text-xs text-gray-200 z-50'>
                <span className='inline-flex items-center gap-2'>
                    <LoaderCircle size={14} className='animate-spin text-yellow-400' />
                    Preparing download…
                </span>
            </div>
        )}
    </>
    )
}
