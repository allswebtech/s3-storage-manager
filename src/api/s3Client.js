import { S3Client } from '@aws-sdk/client-s3'

/**
 * Build the S3 client for a saved credential.
 * - forcePathStyle stays on (default of every earlier version; works with all S3-compatible providers).
 * - Checksums only WHEN_REQUIRED: since SDK v3.729 the default adds CRC32 checksums to uploads, which
 *   several S3-compatible providers reject. WHEN_REQUIRED is the pre-3.729 behaviour and is safe on AWS.
 */
export default function createS3Client({ region, endpoint, access_key, secret_key }) {
    return new S3Client({
        region,
        endpoint,
        forcePathStyle: true,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        credentials: {
            accessKeyId: access_key,
            secretAccessKey: secret_key,
        },
    })
}

/** Status code of an SDK error (undefined for network/CORS failures). */
export function httpStatus(err) {
    return err?.$metadata?.httpStatusCode
}

/** Short, user-facing description of an SDK/network error. Never includes credentials. */
export function describeS3Error(err) {
    if (!err) return 'Unknown error'
    if (err.name === 'AbortError') return 'Canceled'
    const status = httpStatus(err)
    const code = err.Code || err.name
    if (status == null && /fetch|network|cors/i.test(String(err.message))) {
        return 'Network or CORS error: the storage endpoint could not be reached from the browser'
    }
    if (status === 403 || code === 'AccessDenied') return `Access denied${err.message && err.message !== code ? `: ${err.message}` : ''}`
    if (code === 'NoSuchBucket') return 'Bucket not found'
    if (code && err.message && err.message !== code && !/^UnknownError$/.test(code)) return `${code}: ${err.message}`
    return err.message || code || 'Request failed'
}
