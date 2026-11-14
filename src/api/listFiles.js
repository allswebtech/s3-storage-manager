import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { stripPrefix, toPrefix } from '../helpers/keys'

/** One page of a folder listing (folders first, then files). */
export default async function listFiles(s3, prefix = '', bucketName = '', opts = {}) {
    if (!s3) throw new Error('S3 client is not initialized')
    const { continuationToken, signal } = opts || {}
    const normalizedPrefix = toPrefix(prefix)

    const response = await s3.send(new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: normalizedPrefix || undefined,
        Delimiter: '/',
        ContinuationToken: continuationToken || undefined,
    }), signal ? { abortSignal: signal } : undefined)

    const folders = (response.CommonPrefixes || [])
        .filter(p => p.Prefix && p.Prefix !== normalizedPrefix)
        .map(p => ({
            name: stripPrefix(p.Prefix, normalizedPrefix).replace(/\/$/, ''),
            type: 'folder',
            key: p.Prefix,
        }))

    const files = (response.Contents || [])
        .filter(obj => obj.Key !== normalizedPrefix)
        .map(obj => ({
            name: stripPrefix(obj.Key, normalizedPrefix),
            type: 'file',
            key: obj.Key,
            size: obj.Size,
            lastModified: obj.LastModified,
        }))

    return {
        items: [...folders, ...files],
        isTruncated: Boolean(response.IsTruncated),
        nextContinuationToken: response.NextContinuationToken || null,
    }
}
