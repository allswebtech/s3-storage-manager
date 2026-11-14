import { GetObjectCommand } from '@aws-sdk/client-s3'
import listAllObjects from './listAllObjects'
import { stripPrefix, toPrefix } from '../helpers/keys'

// JSZip keeps the whole archive in memory; above this the browser tab is likely to run out of memory.
export const DEFAULT_MAX_ZIP_BYTES = 1024 * 1024 * 1024

export class ZipTooLargeError extends Error {
    constructor(total, max) {
        super(`Selection is too large to zip in the browser (${Math.round(total / 1048576)} MB, limit ${Math.round(max / 1048576)} MB). Download the files individually.`)
        this.name = 'ZipTooLargeError'
        this.total = total
    }
}

/**
 * Work out which objects go into the archive and under which path. Paths are relative to `rootPrefix`
 * (the folder the user is looking at); a selected file sits at the archive root, a selected folder keeps
 * its name. items: [{ type: 'file'|'folder', key, name, size? }]
 */
export async function collectZipEntries(s3, items, bucketName, rootPrefix = '') {
    const root = toPrefix(rootPrefix)
    const entries = []
    for (const item of items) {
        if (item.type === 'folder') {
            const folderPrefix = toPrefix(item.key)
            const folderPath = stripPrefix(folderPrefix, root) || `${item.name}/`
            entries.push({ key: folderPrefix, zipPath: folderPath, size: 0, isDir: true })
            for (const obj of await listAllObjects(s3, folderPrefix, bucketName)) {
                const rel = stripPrefix(obj.Key, folderPrefix)
                entries.push({ key: obj.Key, zipPath: folderPath + rel, size: obj.Size || 0, isDir: obj.Key.endsWith('/') })
            }
        } else {
            const rel = item.key.startsWith(root) ? stripPrefix(item.key, root) : (item.name || item.key.split('/').pop())
            entries.push({ key: item.key, zipPath: rel, size: item.size || 0, isDir: false })
        }
    }
    return entries
}

async function getBytes(s3, bucketName, key) {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }))
    return res.Body ? res.Body.transformToByteArray() : new Uint8Array()
}

/**
 * Build a JSZip archive for the selection. Bytes are read with signed SDK GetObject requests
 * (never the public CDN URL). Throws ZipTooLargeError before downloading when over maxBytes.
 */
export async function buildSelectionZip(s3, items, bucketName, { rootPrefix = '', maxBytes = DEFAULT_MAX_ZIP_BYTES, onProgress } = {}) {
    const { default: JSZip } = await import('jszip')
    const entries = await collectZipEntries(s3, items, bucketName, rootPrefix)
    const total = entries.reduce((n, e) => n + (e.size || 0), 0)
    if (total > maxBytes) throw new ZipTooLargeError(total, maxBytes)

    const zip = new JSZip()
    let done = 0
    for (const entry of entries) {
        if (entry.isDir) {
            zip.folder(entry.zipPath.replace(/\/+$/, ''))
            continue
        }
        zip.file(entry.zipPath, await getBytes(s3, bucketName, entry.key))
        done += entry.size || 0
        if (typeof onProgress === 'function') onProgress(done, total)
    }
    return zip
}

export function zipFileName(items) {
    if (items.length === 1) return `${items[0].name || 'download'}.zip`
    return 'selection.zip'
}

/** Build the archive and hand it to the browser as a download. */
export default async function downloadSelectionAsZip(s3, items, bucketName, rootPrefix = '', opts = {}) {
    const zip = await buildSelectionZip(s3, items, bucketName, { rootPrefix, ...opts })
    const blob = await zip.generateAsync({ type: 'blob' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = zipFileName(items)
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
        a.remove()
        URL.revokeObjectURL(href)
    }, 1000)
}
