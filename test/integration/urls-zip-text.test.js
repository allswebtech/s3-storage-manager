import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import getFilePreview from '../../src/api/getFilePreview.js'
import { buildSelectionZip, ZipTooLargeError } from '../../src/api/downloadSelectionAsZip.js'
import { getObjectText, putTextObject, ObjectTooLargeError } from '../../src/api/objectText.js'
import verifyCredential from '../../src/api/verifyCredential.js'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { S3_ENV, createBucket, testClient, uniqueBucketName } from '../s3-env.js'
import { bytes, getText, put, sha256 } from './helpers.js'

const s3 = testClient()
let bucket

beforeAll(async () => {
    bucket = await createBucket(s3, uniqueBucketName('urls'))
    await put(s3, bucket, 'files/Résumé 日本 $&.txt', 'unicode body', { ContentType: 'text/plain' })
    await put(s3, bucket, 'files/plain.txt', 'plain')
    await put(s3, bucket, 'zipme/', '')
    await put(s3, bucket, 'zipme/a.txt', 'A')
    await put(s3, bucket, 'zipme/inner/', '')
    await put(s3, bucket, 'zipme/inner/b.bin', bytes(70_000, 9))
    await put(s3, bucket, 'zipme/inner/empty/', '')
})
afterAll(() => s3.destroy())

describe('getFilePreview', () => {
    it('presigned download URL works and carries an RFC 5987 filename for unicode names', async () => {
        const url = await getFilePreview(s3, 'files/Résumé 日本 $&.txt', true, bucket)
        const res = await fetch(url)
        expect(res.status).toBe(200)
        expect(await res.text()).toBe('unicode body')
        const cd = res.headers.get('content-disposition')
        expect(cd).toMatch(/^attachment; filename="Resume __ \$&\.txt"; filename\*=UTF-8''/)
        const star = decodeURIComponent(cd.split("filename*=UTF-8''")[1])
        expect(star).toBe('Résumé 日本 $&.txt')
    })

    it('presigned view URL works without a disposition', async () => {
        const res = await fetch(await getFilePreview(s3, 'files/plain.txt', false, bucket))
        expect(res.status).toBe(200)
        expect(res.headers.get('content-disposition')).toBeNull()
        expect(await res.text()).toBe('plain')
    })

    it('uses a valid public base URL for views only, and ignores non-http(s) values', async () => {
        expect(await getFilePreview(s3, 'files/a b#?.txt', false, bucket, 'https://cdn.example.com/base/'))
            .toBe('https://cdn.example.com/base/files/a%20b%23%3F.txt')
        const dl = await getFilePreview(s3, 'files/plain.txt', true, bucket, 'https://cdn.example.com')
        expect(dl.startsWith(S3_ENV.endpoint)).toBe(true)
        const js = await getFilePreview(s3, 'files/plain.txt', false, bucket, 'javascript:alert(1)')
        expect(js.startsWith(S3_ENV.endpoint)).toBe(true)
    })
})

describe('zip download', () => {
    async function entries(zip) {
        const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }))
        const out = {}
        for (const [name, entry] of Object.entries(loaded.files)) {
            out[name] = entry.dir ? 'dir' : sha256(Buffer.from(await entry.async('uint8array')))
        }
        return out
    }

    it('zips a folder (recursively, keeping empty folders) and a file next to it', async () => {
        const zip = await buildSelectionZip(s3, [
            { type: 'folder', key: 'zipme/', name: 'zipme' },
            { type: 'file', key: 'files/plain.txt', name: 'plain.txt', size: 5 },
        ], bucket, { rootPrefix: '' })
        const got = await entries(zip)
        expect(got).toEqual({
            'zipme/': 'dir',
            'zipme/a.txt': sha256(Buffer.from('A')),
            'zipme/inner/': 'dir',
            'zipme/inner/b.bin': sha256(bytes(70_000, 9)),
            'zipme/inner/empty/': 'dir',
            'files/': 'dir',
            'files/plain.txt': sha256(Buffer.from('plain')),
        })
    })

    it('paths are relative to the folder being viewed (a file in a folder sits at the archive root)', async () => {
        const zip = await buildSelectionZip(s3, [{ type: 'file', key: 'zipme/inner/b.bin', name: 'b.bin', size: 70_000 }], bucket, { rootPrefix: 'zipme/inner/' })
        expect(Object.keys(await entries(zip))).toEqual(['b.bin'])
        const zip2 = await buildSelectionZip(s3, [{ type: 'folder', key: 'zipme/inner/', name: 'inner' }], bucket, { rootPrefix: '/zipme' })
        expect(Object.keys(await entries(zip2)).sort()).toEqual(['inner/', 'inner/b.bin', 'inner/empty/'])
    })

    it('refuses selections above the size limit before downloading anything', async () => {
        await expect(buildSelectionZip(s3, [{ type: 'folder', key: 'zipme/', name: 'zipme' }], bucket, { maxBytes: 1000 }))
            .rejects.toBeInstanceOf(ZipTooLargeError)
    })
})

describe('text objects', () => {
    it('reads text through the SDK and saves it back keeping content type and metadata', async () => {
        await put(s3, bucket, 'edit/notes.md', '# Title', { ContentType: 'text/x-custom; charset=utf-8', Metadata: { owner: 'kevin' }, CacheControl: 'max-age=60' })
        const loaded = await getObjectText(s3, bucket, 'edit/notes.md')
        expect(loaded.text).toBe('# Title')
        expect(loaded.contentType).toBe('text/x-custom; charset=utf-8')
        await putTextObject(s3, bucket, 'edit/notes.md', '# Title\n\nedited ✓', { contentType: loaded.contentType, preserve: loaded.metadata })
        expect(await getText(s3, bucket, 'edit/notes.md')).toBe('# Title\n\nedited ✓')
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: 'edit/notes.md' }))
        expect(head.ContentType).toBe('text/x-custom; charset=utf-8')
        expect(head.Metadata).toEqual({ owner: 'kevin' })
        expect(head.CacheControl).toBe('max-age=60')
    })

    it('refuses to load objects above the inline limit', async () => {
        await put(s3, bucket, 'edit/big.txt', 'x'.repeat(2000))
        await expect(getObjectText(s3, bucket, 'edit/big.txt', { maxBytes: 1000 })).rejects.toBeInstanceOf(ObjectTooLargeError)
    })

    it('a missing object is an error, never empty content', async () => {
        await expect(getObjectText(s3, bucket, 'edit/missing.txt')).rejects.toMatchObject({ name: 'NoSuchKey' })
    })
})

describe('verifyCredential', () => {
    it('accepts valid credentials and rejects a wrong secret or bucket', async () => {
        const cred = { ...S3_ENV, name: bucket }
        await expect(verifyCredential(cred)).resolves.toBe(true)
        await expect(verifyCredential({ ...cred, secret_key: 'wrong-secret' })).rejects.toBeTruthy()
        await expect(verifyCredential({ ...cred, name: `${bucket}-nope` })).rejects.toMatchObject({ name: 'NoSuchBucket' })
    })
})
