import { DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

/** Thrown when S3 reports per-object failures inside a DeleteObjects response. */
export class PartialDeleteError extends Error {
    constructor(failures, deletedCount) {
        const first = failures[0]
        super(`${failures.length} object(s) could not be deleted${first ? ` (e.g. "${first.Key}": ${first.Code || 'Error'}${first.Message ? ` - ${first.Message}` : ''})` : ''}`)
        this.name = 'PartialDeleteError'
        this.failures = failures
        this.deletedCount = deletedCount
    }
}

/**
 * Delete a file, or a folder and everything under it (any number of objects).
 * Throws PartialDeleteError when some objects could not be deleted.
 * Returns the number of objects deleted.
 */
export default async function deleteFileOrFolder(s3, key = '', bucketName = '') {
    if (!s3) throw new Error('S3 client is not initialized')
    if (!key) throw new Error('Nothing to delete')

    if (!key.endsWith('/')) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }))
        return 1
    }

    // List everything first, then delete: deleting while paginating can skip keys on some providers.
    const keys = []
    let continuationToken
    do {
        const res = await s3.send(new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: key,
            ContinuationToken: continuationToken,
        }))
        for (const obj of res.Contents || []) keys.push({ Key: obj.Key })
        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (continuationToken)

    const failures = []
    let deleted = 0
    for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000)
        const res = await s3.send(new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: { Objects: chunk, Quiet: true },
        }))
        const errors = res?.Errors || []
        failures.push(...errors)
        deleted += chunk.length - errors.length
    }
    if (failures.length) throw new PartialDeleteError(failures, deleted)
    return deleted
}
