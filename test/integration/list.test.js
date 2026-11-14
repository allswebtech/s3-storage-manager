import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import listFiles from '../../src/api/listFiles.js'
import listAllObjects from '../../src/api/listAllObjects.js'
import addFolder from '../../src/api/addFolder.js'
import headObjectExists from '../../src/api/headObjectExists.js'
import searchFilesAndFolders from '../../src/api/searchFilesAndFolders.js'
import getFolderStats from '../../src/api/getFolderStats.js'
import { createBucket, testClient, uniqueBucketName } from '../s3-env.js'
import { allKeys, put, putMany } from './helpers.js'

const s3 = testClient()
let bucket

beforeAll(async () => {
    bucket = await createBucket(s3, uniqueBucketName('list'))
    await put(s3, bucket, 'root.txt', 'r')
    await put(s3, bucket, 'docs/', '')
    await put(s3, bucket, 'docs/a.md', 'aaaa')
    await put(s3, bucket, 'docs/sub/b.json', '{}')
    await put(s3, bucket, 'docs/sub/deep/c.png', 'ccc')
    await put(s3, bucket, 'docsx/other.txt', 'o')
    await put(s3, bucket, 'empty/', '')
    await put(s3, bucket, 'cash$&/$1.txt', '1')
    await putMany(s3, bucket, Array.from({ length: 1005 }, (_, i) => `many/f${String(i).padStart(4, '0')}.txt`))
})

afterAll(() => s3.destroy())

describe('listFiles', () => {
    it('lists one folder level with folders first and names relative to the folder', async () => {
        const res = await listFiles(s3, '', bucket)
        expect(res.isTruncated).toBe(false)
        expect(res.items.map(i => `${i.type}:${i.name}:${i.key}`)).toEqual([
            'folder:cash$&:cash$&/',
            'folder:docs:docs/',
            'folder:docsx:docsx/',
            'folder:empty:empty/',
            'folder:many:many/',
            'file:root.txt:root.txt',
        ])
        expect(res.items.find(i => i.name === 'root.txt').size).toBe(1)
    })

    it.each(['docs', '/docs', 'docs/', '/docs/', '//docs//'])('normalizes the UI path %j to the docs/ prefix', async (path) => {
        const res = await listFiles(s3, path, bucket)
        expect(res.items.map(i => i.key)).toEqual(['docs/sub/', 'docs/a.md'])
        expect(res.items.map(i => i.name)).toEqual(['sub', 'a.md'])
    })

    it('treats "/" and "" as the bucket root', async () => {
        const a = await listFiles(s3, '/', bucket)
        const b = await listFiles(s3, '', bucket)
        expect(a.items).toEqual(b.items)
    })

    it('does not leak sibling prefixes (docs vs docsx) and skips the folder marker itself', async () => {
        const res = await listFiles(s3, 'docs/', bucket)
        expect(res.items.some(i => i.key.startsWith('docsx'))).toBe(false)
        expect(res.items.some(i => i.key === 'docs/')).toBe(false)
    })

    it('keeps `$` patterns in names literally', async () => {
        const res = await listFiles(s3, 'cash$&/', bucket)
        expect(res.items.map(i => i.name)).toEqual(['$1.txt'])
    })

    it('paginates past 1000 keys with a continuation token', async () => {
        const first = await listFiles(s3, 'many/', bucket)
        expect(first.isTruncated).toBe(true)
        expect(first.items).toHaveLength(1000)
        expect(first.nextContinuationToken).toBeTruthy()
        const second = await listFiles(s3, 'many/', bucket, { continuationToken: first.nextContinuationToken })
        expect(second.isTruncated).toBe(false)
        expect(second.items).toHaveLength(5)
        const all = new Set([...first.items, ...second.items].map(i => i.key))
        expect(all.size).toBe(1005)
    })

    it('an empty folder lists nothing', async () => {
        expect((await listFiles(s3, 'empty/', bucket)).items).toEqual([])
    })

    it('rejects with the S3 error for a missing bucket', async () => {
        await expect(listFiles(s3, '', `${bucket}-missing`)).rejects.toMatchObject({ name: 'NoSuchBucket' })
    })
})

describe('listAllObjects', () => {
    it('lists recursively across pages and skips the folder marker', async () => {
        const all = await listAllObjects(s3, 'many', bucket)
        expect(all).toHaveLength(1005)
        const docs = await listAllObjects(s3, '/docs/', bucket)
        expect(docs.map(o => o.Key).sort()).toEqual(['docs/a.md', 'docs/sub/b.json', 'docs/sub/deep/c.png'])
    })
})

describe('addFolder', () => {
    it('creates a folder marker and refuses an existing folder', async () => {
        const key = await addFolder(s3, 'new folder $&', bucket)
        expect(key).toBe('new folder $&/')
        expect(await allKeys(s3, bucket, 'new folder')).toEqual(['new folder $&/'])
        await expect(addFolder(s3, 'new folder $&/', bucket)).rejects.toMatchObject({ name: 'DestinationExistsError' })
        await expect(addFolder(s3, 'docs', bucket)).rejects.toMatchObject({ name: 'DestinationExistsError' })
    })

    it('rejects an empty name', async () => {
        await expect(addFolder(s3, '', bucket)).rejects.toThrow(/empty/)
    })
})

describe('headObjectExists', () => {
    it('distinguishes exact keys from keys sharing a prefix', async () => {
        expect(await headObjectExists(s3, 'root.txt', bucket)).toBe(true)
        expect(await headObjectExists(s3, 'root', bucket)).toBe(false)
        expect(await headObjectExists(s3, 'docs/a', bucket)).toBe(false)
        expect(await headObjectExists(s3, 'docs/a.md', bucket)).toBe(true)
        expect(await headObjectExists(s3, 'missing.txt', bucket)).toBe(false)
    })

    it('checks folders by prefix (with or without a marker object)', async () => {
        expect(await headObjectExists(s3, 'docs/', bucket)).toBe(true)
        expect(await headObjectExists(s3, 'docs/sub/', bucket)).toBe(true) // no marker, only children
        expect(await headObjectExists(s3, 'empty/', bucket)).toBe(true) // marker only
        expect(await headObjectExists(s3, 'doc/', bucket)).toBe(false)
    })

    it('throws instead of guessing when the storage answers with an error', async () => {
        await expect(headObjectExists(s3, 'x/', `${bucket}-missing`)).rejects.toMatchObject({ name: 'NoSuchBucket' })
        await expect(headObjectExists(s3, 'x.txt', `${bucket}-missing`)).rejects.toBeTruthy()
    })
})

describe('searchFilesAndFolders', () => {
    it('finds files and folders by name, case-insensitive, recursively', async () => {
        const res = await searchFilesAndFolders(s3, '/', 'SUB', bucket)
        expect(res.map(r => `${r.type}:${r.key}`)).toEqual(['folder:docs/sub/'])
        const files = await searchFilesAndFolders(s3, '', '.json', bucket)
        expect(files.map(r => r.key)).toEqual(['docs/sub/b.json'])
    })

    it('searches inside the current folder given as a UI path with a leading slash', async () => {
        const res = await searchFilesAndFolders(s3, '/docs', 'dee', bucket)
        expect(res.map(r => r.key)).toEqual(['docs/sub/deep/'])
        const png = await searchFilesAndFolders(s3, '/docs', 'c.png', bucket)
        expect(png.map(r => r.key)).toEqual(['docs/sub/deep/c.png'])
        const none = await searchFilesAndFolders(s3, '/docs/', 'other', bucket)
        expect(none).toEqual([]) // docsx/ is a sibling, not a child
    })

    it('returns every file under the folder when there is no term (type filter)', async () => {
        const res = await searchFilesAndFolders(s3, 'docs/', '', bucket)
        expect(res.map(r => r.key).sort()).toEqual(['docs/a.md', 'docs/sub/b.json', 'docs/sub/deep/c.png'])
        expect(res.every(r => r.type === 'file')).toBe(true)
    })
})

describe('getFolderStats', () => {
    it('sums sizes and dates of everything below a folder', async () => {
        const stats = await getFolderStats(s3, 'docs/', bucket)
        expect(stats.objectCount).toBe(3)
        expect(stats.totalSize).toBe(4 + 2 + 3)
        expect(stats.earliestLastModified).toBeInstanceOf(Date)
        expect(stats.latestLastModified.getTime()).toBeGreaterThanOrEqual(stats.earliestLastModified.getTime())
        const many = await getFolderStats(s3, '/many', bucket)
        expect(many.objectCount).toBe(1005)
    })
})
