import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { test, expect, getText, listKeys, openWithCredential, putObject, row, rowAction } from './fixtures.js'

test('rename file and folder, copy and move', async ({ page, s3, bucket, problems }) => {
    void problems
    await putObject(s3, bucket, 'report.txt', 'R')
    await putObject(s3, bucket, 'taken.txt', 'T')
    await putObject(s3, bucket, 'docs/inner.txt', 'I')
    await putObject(s3, bucket, 'archive/', '')
    await openWithCredential(page, bucket)

    // rename onto an existing name is refused, nothing changes
    await rowAction(page, 'report.txt', 'Rename')
    let dialog = page.getByRole('dialog', { name: 'Rename' })
    await dialog.getByLabel('New Name').fill('taken')
    await dialog.getByRole('button', { name: 'Rename' }).click()
    await expect(dialog.getByRole('alert')).toContainText('already exists')
    await dialog.getByLabel('New Name').fill('final report')
    await dialog.getByRole('button', { name: 'Rename' }).click()
    await expect(row(page, 'final report.txt')).toBeVisible()

    await rowAction(page, 'docs', 'Rename')
    dialog = page.getByRole('dialog', { name: 'Rename' })
    await dialog.getByLabel('New Name').fill('documents v1.0')
    await dialog.getByRole('button', { name: 'Rename' }).click()
    await expect(row(page, 'documents v1.0')).toBeVisible()
    expect(await listKeys(s3, bucket)).toEqual(['archive/', 'documents v1.0/inner.txt', 'final report.txt', 'taken.txt'])

    // copy a file into a folder
    await rowAction(page, 'taken.txt', 'Copy to…')
    dialog = page.getByRole('dialog', { name: 'Copy Item' })
    await dialog.getByLabel('Destination path or folder').fill('archive/')
    await dialog.getByRole('button', { name: 'Copy' }).click()
    await expect(dialog).toHaveCount(0)
    // move a folder into another folder
    await rowAction(page, 'documents v1.0', 'Move to…')
    dialog = page.getByRole('dialog', { name: 'Move Item' })
    await dialog.getByLabel('Destination path or folder').fill('archive/')
    await dialog.getByRole('button', { name: 'Move' }).click()
    await expect(row(page, 'documents v1.0')).toHaveCount(0)
    expect(await listKeys(s3, bucket)).toEqual(['archive/', 'archive/documents v1.0/inner.txt', 'archive/taken.txt', 'final report.txt', 'taken.txt'])

    // copy again with "Skip" on conflict leaves the existing copy alone; "Auto rename" creates a numbered copy
    await rowAction(page, 'taken.txt', 'Copy to…')
    dialog = page.getByRole('dialog', { name: 'Copy Item' })
    await dialog.getByLabel('Destination path or folder').fill('archive/')
    await dialog.getByLabel('On conflict').selectOption('rename')
    await dialog.getByRole('button', { name: 'Copy' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await listKeys(s3, bucket, 'archive/taken')).toEqual(['archive/taken (1).txt', 'archive/taken.txt'])
})

test('preview and edit a text file; large files cannot be overwritten from the preview', async ({ page, s3, bucket, problems }) => {
    void problems
    await putObject(s3, bucket, 'notes.md', '# Notes', 'text/markdown; charset=utf-8')
    await putObject(s3, bucket, 'data.json', '{"a":1}', 'application/json')
    await putObject(s3, bucket, 'huge.txt', 'x'.repeat(2 * 1024 * 1024), 'text/plain')
    await openWithCredential(page, bucket)

    await page.getByRole('button', { name: 'notes.md', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'Preview: notes.md' })
    const editor = dialog.getByLabel('Contents of notes.md')
    await expect(editor).toHaveValue('# Notes')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled() // nothing changed yet
    await editor.fill('# Notes\n\nedited – ✓')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Saved notes.md')).toBeVisible()
    expect(await getText(s3, bucket, 'notes.md')).toEqual({ text: '# Notes\n\nedited – ✓', contentType: 'text/markdown; charset=utf-8' })
    await dialog.getByRole('button', { name: 'Close' }).click()

    // JSON is editable too
    await page.getByRole('button', { name: 'data.json', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Preview: data.json' })
    await expect(dialog.getByLabel('Contents of data.json')).toHaveValue('{"a":1}')
    await dialog.getByLabel('Contents of data.json').fill('{"a":2}')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Saved data.json')).toBeVisible()
    expect((await getText(s3, bucket, 'data.json')).text).toBe('{"a":2}')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // Large file: no editor, no Save; the previous file's content never shows up
    await page.getByRole('button', { name: 'huge.txt', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Preview: huge.txt' })
    await expect(dialog.getByText('File too large to open inline')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save' })).toHaveCount(0)
    await expect(dialog.getByRole('textbox')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close' }).click()
    expect((await getText(s3, bucket, 'huge.txt')).text.length).toBe(2 * 1024 * 1024)
})

test('search, type filter and info modal URLs', async ({ page, s3, bucket, problems }) => {
    void problems
    await putObject(s3, bucket, 'photos/2024/beach.png', 'png')
    await putObject(s3, bucket, 'photos/readme.txt', 'readme')
    await putObject(s3, bucket, 'Ünïcode name.txt', 'unicode', 'text/plain')
    await openWithCredential(page, bucket)

    await page.getByLabel('Search files and folders').fill('beach')
    await expect(row(page, 'beach.png')).toBeVisible()
    await expect(page.getByTestId('finder-row')).toHaveCount(1)
    await page.getByLabel('Search files and folders').fill('')
    await page.getByLabel('Filter by file type').selectOption('image')
    await expect(row(page, 'beach.png')).toBeVisible()
    await expect(page.getByTestId('finder-row')).toHaveCount(1)
    // search inside a sub-folder
    await page.getByLabel('Filter by file type').selectOption('all')
    await page.getByRole('button', { name: 'photos', exact: true }).click()
    await page.getByLabel('Search files and folders').fill('read')
    await expect(row(page, 'readme.txt')).toBeVisible()
    await page.getByLabel('Search files and folders').fill('')
    await page.getByRole('navigation', { name: 'Folder path' }).getByRole('button', { name: 'Go to bucket root' }).click()

    await page.getByRole('button', { name: 'Details of Ünïcode name.txt' }).click()
    const dialog = page.getByRole('dialog', { name: 'Object Details' })
    await expect(dialog.getByLabel('Download URL')).not.toHaveValue('')
    const view = await dialog.getByLabel('View URL').inputValue()
    const download = await dialog.getByLabel('Download URL').inputValue()
    const v = await fetch(view)
    expect(await v.text()).toBe('unicode')
    const d = await fetch(download)
    expect(await d.text()).toBe('unicode')
    expect(decodeURIComponent(d.headers.get('content-disposition').split("filename*=UTF-8''")[1])).toBe('Ünïcode name.txt')
    await dialog.getByRole('button', { name: 'Close' }).click()

    // folder details: size of everything below
    await page.getByRole('button', { name: 'Details of photos' }).click()
    await expect(page.getByRole('dialog', { name: 'Object Details' })).toContainText('9 B')
})

test('zip download of a selection, single and bulk delete', async ({ page, s3, bucket, problems }) => {
    void problems
    await putObject(s3, bucket, 'a.txt', 'A')
    await putObject(s3, bucket, 'dir/', '')
    await putObject(s3, bucket, 'dir/b.txt', 'B')
    await putObject(s3, bucket, 'dir/sub/c.txt', 'C')
    await putObject(s3, bucket, 'gone.txt', 'G')
    await putObject(s3, bucket, 'x1.txt', '1')
    await putObject(s3, bucket, 'x2.txt', '2')
    await openWithCredential(page, bucket)

    await page.getByLabel('Select a.txt').check()
    await page.getByLabel('Select dir').check()
    await expect(page.getByText('2 selected')).toBeVisible()
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download', exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toBe('selection.zip')
    const zip = await JSZip.loadAsync(readFileSync(await download.path()))
    expect(Object.keys(zip.files).sort()).toEqual(['a.txt', 'dir/', 'dir/b.txt', 'dir/sub/', 'dir/sub/c.txt'])
    expect(await zip.file('dir/sub/c.txt').async('string')).toBe('C')
    await page.getByRole('button', { name: 'Clear', exact: true }).last().click()

    // single delete
    await rowAction(page, 'gone.txt', 'Delete')
    await page.getByRole('dialog', { name: 'Delete File' }).getByRole('button', { name: 'Delete' }).click()
    await expect(row(page, 'gone.txt')).toHaveCount(0)

    // folder delete needs the name typed
    await rowAction(page, 'dir', 'Delete')
    const fd = page.getByRole('dialog', { name: 'Delete Folder' })
    await expect(fd.getByRole('button', { name: 'Delete' })).toBeDisabled()
    await fd.getByRole('textbox').fill('dir')
    await fd.getByRole('button', { name: 'Delete' }).click()
    await expect(row(page, 'dir')).toHaveCount(0)

    // select all + bulk delete
    await page.getByLabel('Select all').check()
    await expect(page.getByText('3 selected')).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    const bd = page.getByRole('dialog', { name: 'Delete 3 item(s)' })
    await bd.getByLabel('Type DELETE to confirm').fill('DELETE')
    await bd.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('No files or folders in this directory.')).toBeVisible()
    expect(await listKeys(s3, bucket)).toEqual([])
})

test('preview state never leaks from one file to the next (no destructive save)', async ({ page, s3, bucket, problems }) => {
    void problems
    await putObject(s3, bucket, 'a-small.txt', 'SMALL CONTENT', 'text/plain')
    await putObject(s3, bucket, 'b-huge.txt', 'y'.repeat(2 * 1024 * 1024), 'text/plain')
    await openWithCredential(page, bucket)

    await page.getByRole('button', { name: 'a-small.txt', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'Preview: a-small.txt' })
    await expect(dialog.getByLabel('Contents of a-small.txt')).toHaveValue('SMALL CONTENT')
    await dialog.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('button', { name: 'b-huge.txt', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Preview: b-huge.txt' })
    await expect(dialog.getByText('File too large to open inline')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save' })).toHaveCount(0)
    await expect(dialog).not.toContainText('SMALL CONTENT')
    await dialog.getByRole('button', { name: 'Close' }).click()
    expect((await getText(s3, bucket, 'b-huge.txt')).text.length).toBe(2 * 1024 * 1024)
    expect((await getText(s3, bucket, 'a-small.txt')).text).toBe('SMALL CONTENT')
})
