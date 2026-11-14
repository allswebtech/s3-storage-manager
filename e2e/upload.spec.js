import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { test, expect, getBytes, getText, listKeys, openWithCredential, putObject, row, uploadFiles, uploadItem } from './fixtures.js'

const sha = (b) => createHash('sha256').update(b).digest('hex')

test('upload small, empty, multi-part and a folder', async ({ page, s3, bucket, problems }) => {
    void problems
    await openWithCredential(page, bucket)
    const big = Buffer.alloc(11 * 1024 * 1024 + 321)
    for (let i = 0; i < big.length; i += 4096) big[i] = (i / 4096) % 251
    await uploadFiles(page, [
        { name: 'small.txt', mimeType: 'text/plain', buffer: Buffer.from('small file') },
        { name: 'empty.dat', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) },
        { name: 'big.bin', mimeType: 'application/octet-stream', buffer: big },
    ])
    for (const n of ['small.txt', 'empty.dat', 'big.bin']) await expect(row(page, n)).toBeVisible({ timeout: 60_000 })
    expect(await getText(s3, bucket, 'small.txt')).toEqual({ text: 'small file', contentType: 'text/plain' })
    expect((await getBytes(s3, bucket, 'empty.dat')).length).toBe(0)
    expect(sha(await getBytes(s3, bucket, 'big.bin'))).toBe(sha(big))

    // The same file can be selected again (input is cleared) and is then reported as a conflict
    await uploadFiles(page, [{ name: 'small.txt', mimeType: 'text/plain', buffer: Buffer.from('again') }])
    await expect(uploadItem(page, 'small.txt').and(page.locator('[data-status="conflict"]'))).toBeVisible()
    await page.getByRole('button', { name: 'Clear', exact: true }).first().click()

    // Folder upload keeps the structure
    const dir = mkdtempSync(join(tmpdir(), 's3sm-'))
    mkdirSync(join(dir, 'album', 'nested'), { recursive: true })
    writeFileSync(join(dir, 'album', 'one.txt'), '1')
    writeFileSync(join(dir, 'album', 'nested', 'two.txt'), '2')
    await page.getByTestId('folder-input').setInputFiles(join(dir, 'album'))
    await expect(row(page, 'album')).toBeVisible()
    expect(await listKeys(s3, bucket, 'album/')).toEqual(['album/nested/two.txt', 'album/one.txt'])
})

test('upload conflicts: replace, keep both, skip', async ({ page, s3, bucket, problems }) => {
    void problems
    await putObject(s3, bucket, 'r.txt', 'old r')
    await putObject(s3, bucket, 'k.txt', 'old k')
    await putObject(s3, bucket, 'k (1).txt', 'old k1')
    await putObject(s3, bucket, 's.txt', 'old s')
    await openWithCredential(page, bucket)
    await uploadFiles(page, ['r', 'k', 's'].map(n => ({ name: `${n}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`new ${n}`) })))
    await expect(page.getByText('3 files already exist in this folder')).toBeVisible()

    await uploadItem(page, 'r.txt').getByRole('button', { name: 'Replace' }).click()
    await uploadItem(page, 'k.txt').getByRole('button', { name: 'Keep Both' }).click()
    await uploadItem(page, 's.txt').getByRole('button', { name: 'Skip' }).click()
    await expect(uploadItem(page, 's.txt')).toHaveAttribute('data-status', 'skipped')
    await expect(row(page, 'k (2).txt')).toBeVisible()

    expect((await getText(s3, bucket, 'r.txt')).text).toBe('new r')
    expect((await getText(s3, bucket, 'k.txt')).text).toBe('old k')
    expect((await getText(s3, bucket, 'k (1).txt')).text).toBe('old k1')
    expect((await getText(s3, bucket, 'k (2).txt')).text).toBe('new k')
    expect((await getText(s3, bucket, 's.txt')).text).toBe('old s')
})
