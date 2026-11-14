import listAllObjects from './listAllObjects'
import { toPrefix } from '../helpers/keys'

/**
 * Recursive search under a folder. With a term: files and folders whose own name contains it
 * (case-insensitive). Without a term: every file (used by the type filter).
 */
export default async function searchFilesAndFolders(s3, prefix, searchTerm, bucketName, { signal } = {}) {
    const term = typeof searchTerm === 'string' ? searchTerm.trim().toLowerCase() : ''
    const normPrefix = toPrefix(prefix)
    const allObjects = await listAllObjects(s3, normPrefix, bucketName, { signal })
    const results = []
    const seenFolderKeys = new Set()

    for (const obj of allObjects) {
        const key = obj.Key
        if (normPrefix && !key.startsWith(normPrefix)) continue
        const parts = key.slice(normPrefix.length).split('/')

        if (!key.endsWith('/')) {
            const fileName = parts[parts.length - 1]
            if (!term || fileName.toLowerCase().includes(term)) {
                results.push({ name: fileName, type: 'file', key, size: obj.Size, lastModified: obj.LastModified })
            }
        }
        if (!term) continue

        let rel = ''
        for (const segment of parts.slice(0, -1)) {
            if (!segment) continue
            rel += `${segment}/`
            const fullKey = normPrefix + rel
            if (seenFolderKeys.has(fullKey)) continue
            seenFolderKeys.add(fullKey)
            if (segment.toLowerCase().includes(term)) {
                results.push({ name: segment, type: 'folder', key: fullKey })
            }
        }
    }
    return results
}
