import { HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { httpStatus } from './s3Client'

/**
 * Does `key` exist? For a folder prefix (ends with '/') this is "is there any object under it".
 * Uses ListObjectsV2 first (no 404 noise in the browser console), falls back to HEAD when listing is
 * not permitted. Errors other than "not found" are thrown: callers must not guess.
 */
export default async function headObjectExists(s3, key, bucketName) {
    if (!s3) throw new Error('S3 client is not initialized')
    if (!key) return false

    let listError
    try {
        const res = await s3.send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: key, MaxKeys: 1 }))
        const first = res?.Contents?.[0]
        if (key.endsWith('/')) {
            const count = typeof res?.KeyCount === 'number' ? res.KeyCount : (res?.Contents?.length || 0)
            return count > 0 || (res?.CommonPrefixes?.length || 0) > 0
        }
        // The key itself sorts before every longer key with the same prefix.
        return Boolean(first && first.Key === key)
    } catch (err) {
        listError = err
    }

    // Only a missing ListBucket permission is a reason to try HEAD; anything else is a real error.
    if (key.endsWith('/') || (httpStatus(listError) !== 403 && listError?.name !== 'AccessDenied')) throw listError
    try {
        await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }))
        return true
    } catch (err) {
        if (httpStatus(err) === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') return false
        throw err
    }
}
