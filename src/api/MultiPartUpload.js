import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    PutObjectCommand,
    UploadPartCommand,
} from '@aws-sdk/client-s3'
import { toPrefix } from '../helpers/keys'

export const MIN_PART_SIZE = 5 * 1024 * 1024
export const MAX_PARTS = 10000
const MiB = 1024 * 1024

/** Part size for a file: at least `preferred`, large enough to stay within 10,000 parts, whole MiB. */
export function choosePartSize(fileSize, preferred = MIN_PART_SIZE) {
    const needed = Math.ceil(fileSize / MAX_PARTS)
    const size = Math.max(preferred, needed)
    return Math.ceil(size / MiB) * MiB
}

function abortError() {
    const err = new Error('Upload canceled')
    err.name = 'AbortError'
    return err
}

/** Target key: explicit opts.targetKey, else current directory + the file's relative path. */
export function uploadKeyFor(file, currentDirectory = '/', targetKey) {
    if (typeof targetKey === 'string' && targetKey.length > 0) return targetKey
    const relativeKey = (file.webkitRelativePath || file.relativePath || file.name || '').replace(/^\/+/, '')
    return toPrefix(currentDirectory) + relativeKey
}

/**
 * Upload a File/Blob. Files up to one part go through a single PutObject (this includes 0-byte files);
 * larger files use a multipart upload with ordered parts and bounded concurrency.
 *
 * opts: { onProgress(uploadedBytes, totalBytes), signal: AbortSignal, partSize, concurrency, targetKey }
 * Resolves with the object key. Rejects with an error named 'AbortError' when canceled, otherwise with
 * the S3/network error. A failed or canceled multipart upload is aborted on the server (best effort).
 */
export default async function MultiPartUpload(s3, file, currentDirectory = '/', bucketName = '', opts = {}) {
    if (!s3) throw new Error('S3 client is not initialized')
    const { onProgress, signal, partSize, concurrency, targetKey } = opts || {}
    const key = uploadKeyFor(file, currentDirectory, targetKey)
    if (!key) throw new Error('File has no name')

    const fileSize = file.size || 0
    const contentType = file.type || 'application/octet-stream'
    const chunkSize = partSize ? Math.max(1, partSize) : choosePartSize(fileSize)
    const report = (n) => {
        if (typeof onProgress !== 'function') return
        try { onProgress(n, fileSize) } catch { /* progress UI errors must not break the upload */ }
    }

    if (signal?.aborted) throw abortError()

    // Internal controller: cancels every in-flight request on user cancel OR on the first failed part.
    const controller = new AbortController()
    const onUserAbort = () => controller.abort()
    signal?.addEventListener?.('abort', onUserAbort, { once: true })
    const sendOpts = { abortSignal: controller.signal }

    try {
        if (fileSize <= chunkSize) {
            const body = new Uint8Array(await file.arrayBuffer())
            await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: body, ContentType: contentType }), sendOpts)
            report(fileSize)
            return key
        }

        const totalParts = Math.ceil(fileSize / chunkSize)
        if (totalParts > MAX_PARTS) throw new Error(`File needs ${totalParts} parts; S3 allows at most ${MAX_PARTS}`)

        let uploadId = ''
        try {
            const createRes = await s3.send(new CreateMultipartUploadCommand({
                Bucket: bucketName,
                Key: key,
                ContentType: contentType,
            }), sendOpts)
            uploadId = createRes.UploadId
            if (!uploadId) throw new Error('Storage did not return an upload id')

            const parts = []
            let uploadedBytes = 0
            let nextPart = 1
            let failure = null

            const uploadOne = async (partNumber) => {
                const start = (partNumber - 1) * chunkSize
                const end = Math.min(partNumber * chunkSize, fileSize)
                const body = new Uint8Array(await file.slice(start, end).arrayBuffer())
                if (controller.signal.aborted) throw failure || abortError()
                const res = await s3.send(new UploadPartCommand({
                    Bucket: bucketName,
                    Key: key,
                    UploadId: uploadId,
                    PartNumber: partNumber,
                    Body: body,
                }), sendOpts)
                if (!res.ETag) throw new Error('Storage did not return an ETag for a part (check that CORS exposes the ETag header)')
                parts.push({ ETag: res.ETag, PartNumber: partNumber })
                uploadedBytes += body.length
                report(uploadedBytes)
            }

            const workerCount = Math.min(Math.max(1, Math.min(concurrency || 4, 8)), totalParts)
            const workers = Array.from({ length: workerCount }, async () => {
                while (!controller.signal.aborted) {
                    const current = nextPart++
                    if (current > totalParts) return
                    try {
                        await uploadOne(current)
                    } catch (err) {
                        if (!failure) failure = err
                        controller.abort()
                        return
                    }
                }
            })
            await Promise.all(workers)
            if (signal?.aborted) throw abortError()
            if (failure) throw failure
            if (parts.length !== totalParts) throw new Error('Upload incomplete')

            // S3 requires parts in ascending PartNumber order.
            parts.sort((a, b) => a.PartNumber - b.PartNumber)
            await s3.send(new CompleteMultipartUploadCommand({
                Bucket: bucketName,
                Key: key,
                UploadId: uploadId,
                MultipartUpload: { Parts: parts },
            }))
            return key
        } catch (err) {
            if (uploadId) {
                try {
                    await s3.send(new AbortMultipartUploadCommand({ Bucket: bucketName, Key: key, UploadId: uploadId }))
                } catch { /* best effort; the original error matters more */ }
            }
            throw err
        }
    } catch (err) {
        if (signal?.aborted) throw abortError()
        throw err
    } finally {
        signal?.removeEventListener?.('abort', onUserAbort)
    }
}
