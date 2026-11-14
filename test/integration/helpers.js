import { createHash } from 'node:crypto'
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'

export async function put(s3, bucket, key, body = '', extra = {}) {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ...extra }))
}

export async function getBuffer(s3, bucket, key) {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return Buffer.from(await res.Body.transformToByteArray())
}

export async function getText(s3, bucket, key) {
    return (await getBuffer(s3, bucket, key)).toString('utf8')
}

export async function allKeys(s3, bucket, prefix = '') {
    const keys = []
    let token
    do {
        const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }))
        for (const o of res.Contents || []) keys.push(o.Key)
        token = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (token)
    return keys.sort()
}

/** Put many small objects with bounded concurrency. */
export async function putMany(s3, bucket, keys, concurrency = 32) {
    const queue = [...keys]
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (queue.length) {
            const k = queue.shift()
            await put(s3, bucket, k, k.endsWith('/') ? '' : 'x')
        }
    }))
}

export function sha256(buf) {
    return createHash('sha256').update(buf).digest('hex')
}

/** Deterministic pseudo-random bytes (fast, no crypto needed). */
export function bytes(size, seed = 1) {
    const out = Buffer.allocUnsafe(size)
    let x = seed >>> 0 || 1
    for (let i = 0; i < size; i++) {
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5
        out[i] = x & 0xff
    }
    return out
}

// Keys that broke string-based key handling: URL-special characters, `$` replacement patterns, unicode.
export const SPECIAL_NAMES = [
    'with space.txt',
    'plus+sign.txt',
    'amp&ersand.txt',
    'question?mark.txt',
    'hash#tag.txt',
    'percent%41.txt',
    'dollar$&amp$1$$.txt',
    'ünïcödé-日本語.txt',
    'semi;colon=eq.txt',
]
