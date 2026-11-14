import { CopyObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { encodeCopySource, stripPrefix } from '../helpers/keys'

/**
 * Copy one object (key without trailing '/') or a whole folder (prefix ending with '/').
 * Overwrites existing destination objects: callers check for conflicts first.
 * Returns the number of objects copied.
 */
export default async function copyObjectOrFolder(s3, sourceKeyOrPrefix, destKeyOrPrefix, bucketName) {
    if (!s3) throw new Error('S3 client not initialized')
    if (!sourceKeyOrPrefix || !destKeyOrPrefix) throw new Error('Source and destination are required')
    if (sourceKeyOrPrefix === destKeyOrPrefix) return 0

    const isFolder = sourceKeyOrPrefix.endsWith('/')
    if (!isFolder) {
        if (destKeyOrPrefix.endsWith('/')) throw new Error('Destination of a file copy must be a file key')
        await s3.send(new CopyObjectCommand({
            Bucket: bucketName,
            CopySource: encodeCopySource(bucketName, sourceKeyOrPrefix),
            Key: destKeyOrPrefix,
        }))
        return 1
    }

    const srcPrefix = sourceKeyOrPrefix
    const dstPrefix = destKeyOrPrefix.endsWith('/') ? destKeyOrPrefix : `${destKeyOrPrefix}/`
    if (dstPrefix.startsWith(srcPrefix)) throw new Error('Destination cannot be inside the source folder')

    let copied = 0
    let continuationToken
    do {
        const listRes = await s3.send(new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: srcPrefix,
            ContinuationToken: continuationToken,
        }))
        for (const obj of listRes.Contents || []) {
            await s3.send(new CopyObjectCommand({
                Bucket: bucketName,
                CopySource: encodeCopySource(bucketName, obj.Key),
                Key: dstPrefix + stripPrefix(obj.Key, srcPrefix),
            }))
            copied++
        }
        continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined
    } while (continuationToken)
    return copied
}
