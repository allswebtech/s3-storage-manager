import listAllObjects from './listAllObjects'

/** { totalSize, earliestLastModified, latestLastModified, objectCount } for everything under a prefix. */
export default async function getFolderStats(s3, prefix = '', bucketName = '') {
    if (!s3) throw new Error('S3 client not initialized')
    const objects = await listAllObjects(s3, prefix, bucketName)
    let totalSize = 0
    let earliest = null
    let latest = null
    for (const obj of objects) {
        totalSize += obj.Size || 0
        const lm = obj.LastModified ? new Date(obj.LastModified) : null
        if (lm && !Number.isNaN(lm.getTime())) {
            if (!earliest || lm < earliest) earliest = lm
            if (!latest || lm > latest) latest = lm
        }
    }
    return { totalSize, earliestLastModified: earliest, latestLastModified: latest, objectCount: objects.length }
}
