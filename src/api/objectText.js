import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

export const MAX_EDITABLE_BYTES = 1.5 * 1024 * 1024

export class ObjectTooLargeError extends Error {
    constructor(size, max) {
        super(`File is too large to open inline (${size} bytes, limit ${max})`)
        this.name = 'ObjectTooLargeError'
        this.size = size
    }
}

/**
 * Read an object as UTF-8 text through the SDK (signed request to the endpoint, never the public CDN copy).
 * Returns { text, contentType, etag, metadata } where metadata holds headers worth keeping on save.
 */
export async function getObjectText(s3, bucketName, key, { maxBytes = MAX_EDITABLE_BYTES, signal } = {}) {
    if (!s3) throw new Error('S3 client is not initialized')
    const res = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }), signal ? { abortSignal: signal } : undefined)
    const size = typeof res.ContentLength === 'number' ? res.ContentLength : null
    if (size != null && size > maxBytes) {
        try { await res.Body?.cancel?.() } catch { /* ignore */ }
        try { res.Body?.destroy?.() } catch { /* ignore */ }
        throw new ObjectTooLargeError(size, maxBytes)
    }
    const text = res.Body ? await res.Body.transformToString('utf-8') : ''
    return {
        text,
        contentType: res.ContentType || '',
        etag: res.ETag || '',
        metadata: {
            Metadata: res.Metadata && Object.keys(res.Metadata).length ? res.Metadata : undefined,
            CacheControl: res.CacheControl || undefined,
            ContentDisposition: res.ContentDisposition || undefined,
            ContentLanguage: res.ContentLanguage || undefined,
        },
    }
}

/**
 * Save text content to a key. `preserve` carries headers read by getObjectText so that saving an edit
 * does not drop the object's Content-Type, user metadata, Cache-Control, etc.
 */
export async function putTextObject(s3, bucketName, key, body = '', { contentType = 'text/plain; charset=utf-8', preserve = {} } = {}) {
    if (!s3) throw new Error('S3 client is not initialized')
    const clean = Object.fromEntries(Object.entries(preserve || {}).filter(([, v]) => v !== undefined))
    await s3.send(new PutObjectCommand({ ...clean, Bucket: bucketName, Key: key, Body: body, ContentType: contentType }))
    return true
}
