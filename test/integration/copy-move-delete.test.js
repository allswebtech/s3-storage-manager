import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CopyObjectCommand, PutObjectLegalHoldCommand } from '@aws-sdk/client-s3'
import copyObjectOrFolder from '../../src/api/copyObjectOrFolder.js'
import deleteFileOrFolder, { PartialDeleteError } from '../../src/api/deleteFileOrFolder.js'
import moveObjectOrFolder from '../../src/api/moveObjectOrFolder.js'
import renameFile from '../../src/api/renameFile.js'
import renameFolder from '../../src/api/renameFolder.js'
import { createBucket, testClient, uniqueBucketName } from '../s3-env.js'
import { SPECIAL_NAMES, allKeys, getText, put, putMany } from './helpers.js'

const s3 = testClient()
let bucket

beforeAll(async () => {
    bucket = await createBucket(s3, uniqueBucketName('cmd'))
})
afterAll(() => s3.destroy())

describe('copyObjectOrFolder', () => {
    it.each(SPECIAL_NAMES)('copies a file whose key contains special characters: %s', async (name) => {
        await put(s3, bucket, `src/${name}`, `body of ${name}`)
        await copyObjectOrFolder(s3, `src/${name}`, `dst $& $1/${name}`, bucket)
        expect(await getText(s3, bucket, `dst $& $1/${name}`)).toBe(`body of ${name}`)
    })

    it('copies a folder recursively into a destination whose name contains `$&`, keeping the marker', async () => {
        await put(s3, bucket, 'tree/', '')
        await put(s3, bucket, 'tree/a.txt', 'a')
        await put(s3, bucket, 'tree/tree/b.txt', 'b') // inner segment equal to the source name
        for (const n of SPECIAL_NAMES) await put(s3, bucket, `tree/${n}`, n)
        const copied = await copyObjectOrFolder(s3, 'tree/', 'out/$&tree$1/', bucket)
        expect(copied).toBe(3 + SPECIAL_NAMES.length)
        const keys = await allKeys(s3, bucket, 'out/')
        expect(keys).toEqual(['out/$&tree$1/', 'out/$&tree$1/a.txt', 'out/$&tree$1/tree/b.txt', ...SPECIAL_NAMES.map(n => `out/$&tree$1/${n}`)].sort())
        expect(await getText(s3, bucket, 'out/$&tree$1/tree/b.txt')).toBe('b')
    })

    it('refuses to copy a folder into itself', async () => {
        await expect(copyObjectOrFolder(s3, 'tree/', 'tree/inner/', bucket)).rejects.toThrow(/inside the source/)
    })

    it('copies folders with more than 1000 objects', async () => {
        await putMany(s3, bucket, Array.from({ length: 1003 }, (_, i) => `bigcopy/k${i}`))
        expect(await copyObjectOrFolder(s3, 'bigcopy/', 'bigcopy2/', bucket)).toBe(1003)
        expect((await allKeys(s3, bucket, 'bigcopy2/')).length).toBe(1003)
    })
})

describe('deleteFileOrFolder', () => {
    it('deletes a single file and a folder with more than 1000 objects', async () => {
        await put(s3, bucket, 'single.txt', '1')
        expect(await deleteFileOrFolder(s3, 'single.txt', bucket)).toBe(1)
        await putMany(s3, bucket, ['bigdel/', ...Array.from({ length: 1205 }, (_, i) => `bigdel/sub${i % 3}/k${i}`)])
        expect(await deleteFileOrFolder(s3, 'bigdel/', bucket)).toBe(1206)
        expect(await allKeys(s3, bucket, 'bigdel/')).toEqual([])
    })

    it('does not touch sibling prefixes', async () => {
        await put(s3, bucket, 'sib/a', '1')
        await put(s3, bucket, 'sibling/b', '1')
        await deleteFileOrFolder(s3, 'sib/', bucket)
        expect(await allKeys(s3, bucket, 'sib')).toEqual(['sibling/b'])
    })

    it('reports objects S3 refused to delete (DeleteObjects Errors) instead of claiming success', async () => {
        const locked = await createBucket(s3, uniqueBucketName('lock'), { objectLock: true })
        await put(s3, locked, 'f/keep.txt', 'k')
        await put(s3, locked, 'f/gone1.txt', '1')
        await put(s3, locked, 'f/gone2.txt', '2')
        await s3.send(new PutObjectLegalHoldCommand({ Bucket: locked, Key: 'f/keep.txt', LegalHold: { Status: 'ON' } }))
        const err = await deleteFileOrFolder(s3, 'f/', locked).catch(e => e)
        expect(err).toBeInstanceOf(PartialDeleteError)
        expect(err.failures.map(f => f.Key)).toEqual(['f/keep.txt'])
        expect(err.deletedCount).toBe(2)
        expect(err.message).toMatch(/1 object\(s\) could not be deleted/)
        expect(await allKeys(s3, locked)).toEqual(['f/keep.txt'])
        await s3.send(new PutObjectLegalHoldCommand({ Bucket: locked, Key: 'f/keep.txt', LegalHold: { Status: 'OFF' } }))
    })
})

describe('rename / move', () => {
    it.each(SPECIAL_NAMES)('renames a file with special characters: %s', async (name) => {
        await put(s3, bucket, `ren/${name}`, name)
        await renameFile(s3, `ren/${name}`, `ren/renamed ${name}`, bucket)
        expect(await allKeys(s3, bucket, `ren/${name}`)).toEqual([])
        expect(await getText(s3, bucket, `ren/renamed ${name}`)).toBe(name)
    })

    it('refuses to overwrite an existing file or merge into an existing folder', async () => {
        await put(s3, bucket, 'clash/a.txt', 'A')
        await put(s3, bucket, 'clash/b.txt', 'B')
        await expect(renameFile(s3, 'clash/a.txt', 'clash/b.txt', bucket)).rejects.toMatchObject({ name: 'DestinationExistsError' })
        expect(await getText(s3, bucket, 'clash/a.txt')).toBe('A')
        expect(await getText(s3, bucket, 'clash/b.txt')).toBe('B')

        await put(s3, bucket, 'fa/x.txt', 'x')
        await put(s3, bucket, 'fb/y.txt', 'y')
        await expect(renameFolder(s3, 'fa/', 'fb/', bucket)).rejects.toMatchObject({ name: 'DestinationExistsError' })
        expect(await allKeys(s3, bucket, 'fa/')).toEqual(['fa/x.txt'])
        expect(await allKeys(s3, bucket, 'fb/')).toEqual(['fb/y.txt'])

        // explicit overwrite is allowed
        await moveObjectOrFolder(s3, 'clash/a.txt', 'clash/b.txt', bucket, { overwrite: true })
        expect(await getText(s3, bucket, 'clash/b.txt')).toBe('A')
        expect(await allKeys(s3, bucket, 'clash/')).toEqual(['clash/b.txt'])
    })

    it('renames a folder (with marker, nested objects and special names)', async () => {
        await put(s3, bucket, 'old dir/', '')
        await put(s3, bucket, 'old dir/n/1.txt', '1')
        await put(s3, bucket, `old dir/${SPECIAL_NAMES[6]}`, '$')
        await renameFolder(s3, 'old dir', 'new $& dir', bucket)
        expect(await allKeys(s3, bucket, 'old dir')).toEqual([])
        expect(await allKeys(s3, bucket, 'new $& dir/')).toEqual(['new $& dir/', `new $& dir/${SPECIAL_NAMES[6]}`, 'new $& dir/n/1.txt'].sort())
    })

    it('moves a folder into another folder', async () => {
        await put(s3, bucket, 'mv/src/a.txt', 'a')
        await put(s3, bucket, 'mv/target/', '')
        await moveObjectOrFolder(s3, 'mv/src/', 'mv/target/src/', bucket)
        expect(await allKeys(s3, bucket, 'mv/')).toEqual(['mv/target/', 'mv/target/src/a.txt'])
    })

    it('never deletes the source when a copy fails part-way', async () => {
        await put(s3, bucket, 'half/1.txt', '1')
        await put(s3, bucket, 'half/2.txt', '2')
        await put(s3, bucket, 'half/3.txt', '3')
        let copies = 0
        const failing = {
            send: async (cmd, opts) => {
                if (cmd instanceof CopyObjectCommand && ++copies === 2) throw Object.assign(new Error('copy broke'), { name: 'InternalError' })
                return s3.send(cmd, opts)
            },
        }
        await expect(moveObjectOrFolder(failing, 'half/', 'half2/', bucket)).rejects.toMatchObject({ name: 'InternalError' })
        expect(await allKeys(s3, bucket, 'half/')).toEqual(['half/1.txt', 'half/2.txt', 'half/3.txt'])
    })

    it('reports when the copy worked but the original could not be removed', async () => {
        const locked = await createBucket(s3, uniqueBucketName('lockmv'), { objectLock: true })
        await put(s3, locked, 'a.txt', 'a')
        await s3.send(new PutObjectLegalHoldCommand({ Bucket: locked, Key: 'a.txt', LegalHold: { Status: 'ON' } }))
        // a single locked file is deleted with DeleteObject (hard error); a folder goes through DeleteObjects
        await put(s3, locked, 'dir/x.txt', 'x')
        await s3.send(new PutObjectLegalHoldCommand({ Bucket: locked, Key: 'dir/x.txt', LegalHold: { Status: 'ON' } }))
        const err = await moveObjectOrFolder(s3, 'dir/', 'dir2/', locked).catch(e => e)
        expect(err.name).toBe('MoveCleanupError')
        expect(err.message).toMatch(/original could not be removed/)
        expect(await allKeys(s3, locked, 'dir')).toEqual(['dir/x.txt', 'dir2/x.txt'])
        for (const k of ['a.txt', 'dir/x.txt']) {
            await s3.send(new PutObjectLegalHoldCommand({ Bucket: locked, Key: k, LegalHold: { Status: 'OFF' } }))
        }
    })

    it('rejects moving a folder into itself or a file onto a folder', async () => {
        await expect(moveObjectOrFolder(s3, 'a/', 'a/b/', bucket)).rejects.toThrow(/inside the source/)
        await expect(moveObjectOrFolder(s3, 'a.txt', 'b/', bucket)).rejects.toThrow(/file onto a folder/)
    })
})
