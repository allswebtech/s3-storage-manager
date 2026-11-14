import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { toPrefix } from '../helpers/keys'

/**
 * Every object under a prefix (recursive, all pages). The folder marker equal to the prefix itself is
 * skipped. Returns [{ Key, Size, LastModified }].
 */
export default async function listAllObjects(s3, prefix = '', bucketName = '', { signal } = {}) {
    if (!s3) throw new Error('S3 client is not initialized')
    const normalizedPrefix = toPrefix(prefix)
    const results = []
    let continuationToken

    do {
        const response = await s3.send(new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: normalizedPrefix || undefined,
            ContinuationToken: continuationToken,
        }), signal ? { abortSignal: signal } : undefined)
        for (const obj of response.Contents || []) {
            if (normalizedPrefix && obj.Key === normalizedPrefix) continue
            results.push({ Key: obj.Key, Size: obj.Size, LastModified: obj.LastModified })
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)

    return results
}
