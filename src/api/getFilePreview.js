import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { baseName, encodeKeyPath } from '../helpers/keys'
import { contentDisposition } from '../helpers/contentDisposition'
import { safeHttpUrl } from '../helpers/url'

/**
 * URL to view or download a key.
 * - View (download === false) with a valid http(s) public base URL: `${publicBaseUrl}/${encodedKey}`.
 * - Otherwise a presigned GET URL (1 hour). Downloads are always signed and carry a
 *   Content-Disposition with the object's own file name (ASCII fallback + RFC 5987 UTF-8 name).
 */
export default async function getFilePreview(s3, key, download = false, bucketName = '', publicBaseUrl = '', { expiresIn = 3600 } = {}) {
    if (!s3) throw new Error('S3 client is not initialized')
    if (!key) throw new Error('Key is required')

    const base = safeHttpUrl(publicBaseUrl)
    if (base && !download) {
        return `${base.replace(/\/+$/, '')}/${encodeKeyPath(key)}`
    }

    const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
        ...(download && { ResponseContentDisposition: contentDisposition(baseName(key) || 'file') }),
    })
    return getSignedUrl(s3, command, { expiresIn })
}
