import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ListMultipartUploadsCommand, UploadPartCommand } from '@aws-sdk/client-s3'
import MultiPartUpload, { MIN_PART_SIZE, choosePartSize } from '../../src/api/MultiPartUpload.js'
import { createBucket, testClient, uniqueBucketName } from '../s3-env.js'
import { allKeys, bytes, getBuffer, sha256 } from './helpers.js'

const s3 = testClient()
let bucket

beforeAll(async () => {
    bucket = await createBucket(s3, uniqueBucketName('upload'))
})
afterAll(() => s3.destroy())

const MiB = 1024 * 1024
const file = (buf, name, type = 'application/octet-stream') => new File([buf], name, { type })

async function danglingUploads() {
    const res = await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket }))
    return res.Uploads || []
}

/** Client wrapper that lets a test intercept individual commands. */
function interceptingClient(hook) {
    return {
        send: async (cmd, opts) => {
            await hook(cmd, opts)
            return s3.send(cmd, opts)
        },
    }
}

describe('MultiPartUpload', () => {
    it('uploads a 0-byte file', async () => {
        const key = await MultiPartUpload(s3, file(new Uint8Array(0), 'empty.bin'), '/', bucket)
        expect(key).toBe('empty.bin')
        expect((await getBuffer(s3, bucket, 'empty.bin')).length).toBe(0)
    })

    it('uploads a small file with a single PutObject into the current folder', async () => {
        const seen = []
        const client = interceptingClient((cmd) => { seen.push(cmd.constructor.name) })
        const progress = []
        const key = await MultiPartUpload(client, file(Buffer.from('hello'), 'hi.txt', 'text/plain'), '/dir/sub', bucket, { onProgress: (n, t) => progress.push([n, t]) })
        expect(key).toBe('dir/sub/hi.txt')
        expect(seen).toEqual(['PutObjectCommand'])
        expect((await getBuffer(s3, bucket, 'dir/sub/hi.txt')).toString()).toBe('hello')
        expect(progress.at(-1)).toEqual([5, 5])
    })

    it('honours an explicit targetKey and a folder-relative path', async () => {
        const f = file(Buffer.from('x'), 'a.txt')
        f.relativePath = 'dropped/inner/a.txt'
        expect(await MultiPartUpload(s3, f, '/base/', bucket)).toBe('base/dropped/inner/a.txt')
        expect(await MultiPartUpload(s3, f, '/base/', bucket, { targetKey: 'elsewhere/a (1).txt' })).toBe('elsewhere/a (1).txt')
    })

    it('uploads >= 3 parts in ascending order even when parts finish out of order', async () => {
        const data = bytes(2 * MIN_PART_SIZE + 123_457, 7)
        const completed = []
        const client = interceptingClient(async (cmd) => {
            const name = cmd.constructor.name
            // Part 1 finishes last: the completion order is 2, 3, 1.
            if (name === 'UploadPartCommand' && cmd.input.PartNumber === 1) await new Promise(r => setTimeout(r, 600))
            if (name === 'CompleteMultipartUploadCommand') completed.push(cmd.input.MultipartUpload.Parts.map(p => p.PartNumber))
        })
        const key = await MultiPartUpload(client, file(data, 'big.bin'), '', bucket, { partSize: MIN_PART_SIZE, concurrency: 4 })
        expect(key).toBe('big.bin')
        expect(completed).toEqual([[1, 2, 3]])
        expect(sha256(await getBuffer(s3, bucket, 'big.bin'))).toBe(sha256(data))
        expect(await danglingUploads()).toEqual([])
    })

    it('cancels mid-upload: in-flight parts are aborted, no object and no dangling multipart upload remain', async () => {
        const data = bytes(4 * MIN_PART_SIZE, 3)
        const controller = new AbortController()
        let partsStarted = 0
        const client = interceptingClient(async (cmd, opts) => {
            if (cmd instanceof UploadPartCommand) {
                partsStarted++
                expect(opts?.abortSignal).toBeDefined() // in-flight requests must be cancellable
                if (partsStarted === 2) controller.abort()
            }
        })
        await expect(MultiPartUpload(client, file(data, 'cancel.bin'), '', bucket, { partSize: MIN_PART_SIZE, concurrency: 1, signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' })
        expect(partsStarted).toBeLessThan(4)
        expect(await allKeys(s3, bucket, 'cancel.bin')).toEqual([])
        expect(await danglingUploads()).toEqual([])
    })

    it('a failing part stops the other workers, aborts the upload and rejects with the real error', async () => {
        const data = bytes(4 * MIN_PART_SIZE, 5)
        const started = []
        const client = interceptingClient(async (cmd) => {
            if (cmd instanceof UploadPartCommand) {
                started.push(cmd.input.PartNumber)
                if (cmd.input.PartNumber === 1) {
                    const err = new Error('simulated network failure')
                    err.name = 'NetworkingError'
                    throw err
                }
            }
        })
        await expect(MultiPartUpload(client, file(data, 'fail.bin'), '', bucket, { partSize: MIN_PART_SIZE, concurrency: 1 }))
            .rejects.toMatchObject({ name: 'NetworkingError' })
        expect(started).toEqual([1]) // nothing else was sent after the failure
        expect(await allKeys(s3, bucket, 'fail.bin')).toEqual([])
        expect(await danglingUploads()).toEqual([])
    })

    it('already-aborted signal rejects before sending anything', async () => {
        const controller = new AbortController()
        controller.abort()
        await expect(MultiPartUpload(s3, file(Buffer.from('x'), 'never.txt'), '', bucket, { signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' })
        expect(await allKeys(s3, bucket, 'never.txt')).toEqual([])
    })
})

describe('choosePartSize', () => {
    it('keeps 5 MiB for normal files and grows to stay within 10,000 parts', () => {
        expect(choosePartSize(1)).toBe(5 * MiB)
        expect(choosePartSize(10 * 1024 * MiB)).toBe(5 * MiB)
        const huge = 100 * 1024 * 1024 * MiB // 100 TiB > 48.8 GiB limit of fixed 5 MiB parts
        const size = choosePartSize(huge)
        expect(Math.ceil(huge / size)).toBeLessThanOrEqual(10_000)
        expect(size % MiB).toBe(0)
        const fiftyGiB = 50 * 1024 * MiB
        expect(Math.ceil(fiftyGiB / choosePartSize(fiftyGiB))).toBeLessThanOrEqual(10_000)
    })
})
