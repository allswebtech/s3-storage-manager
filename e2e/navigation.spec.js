import { test, expect, listKeys, openWithCredential, putObject, row } from './fixtures.js'

test('create folder, navigate in and out (UI Back, breadcrumbs, browser back/forward, reload)', async ({ page, s3, bucket, problems }) => {
    void problems
    await putObject(s3, bucket, 'top.txt', 'top')
    await openWithCredential(page, bucket)

    await page.getByRole('button', { name: 'Add Folder' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add Folder' })
    await dialog.getByLabel('Name').fill('bad/name')
    await dialog.getByRole('button', { name: 'Create' }).click()
    await expect(dialog.getByRole('alert')).toContainText('cannot contain "/"')
    await dialog.getByLabel('Name').fill('Projects $&')
    await dialog.getByRole('button', { name: 'Create' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(row(page, 'Projects $&')).toBeVisible()
    expect(await listKeys(s3, bucket)).toEqual(['Projects $&/', 'top.txt'])

    // Escape closes a modal and focus returns to the button that opened it
    await page.getByRole('button', { name: 'Add Folder' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add Folder' })).toBeFocused()

    await page.getByRole('button', { name: 'Projects $&', exact: true }).click()
    await expect(page).toHaveURL(/path=%2FProjects\+%24%26%2F/)
    await expect(page.getByText('No files or folders in this directory.')).toBeVisible()

    await page.getByRole('button', { name: 'Add Folder' }).click()
    await page.getByRole('dialog').getByLabel('Name').fill('inner')
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click()
    await page.getByRole('button', { name: 'inner', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Folder path' })).toContainText('Projects $&/inner')

    // Browser back/forward follow folder navigation and stay inside the app
    await page.goBack()
    await expect(row(page, 'inner')).toBeVisible()
    await page.goBack()
    await expect(row(page, 'top.txt')).toBeVisible()
    await page.goForward()
    await expect(row(page, 'inner')).toBeVisible()

    // Reload keeps the folder
    await page.getByRole('button', { name: 'inner', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Folder path' })).toContainText('Projects $&/inner')

    // In-app Back and breadcrumbs
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(row(page, 'inner')).toBeVisible()
    await page.getByRole('navigation', { name: 'Folder path' }).getByRole('button', { name: 'Go to bucket root' }).click()
    await expect(row(page, 'top.txt')).toBeVisible()

    // Coming back to the app (no ?path) restores the last folder of this bucket
    await page.getByRole('button', { name: 'Projects $&', exact: true }).click()
    await expect(row(page, 'inner')).toBeVisible()
    await page.goto('./')
    await expect(row(page, 'inner')).toBeVisible()
})

test('load more past 1000 items and select all covers every loaded item', async ({ page, s3, bucket, problems }) => {
    void problems
    const keys = Array.from({ length: 1003 }, (_, i) => `f${String(i).padStart(4, '0')}.txt`)
    const queue = [...keys]
    await Promise.all(Array.from({ length: 32 }, async () => {
        while (queue.length) await putObject(s3, bucket, queue.shift(), 'x')
    }))
    await openWithCredential(page, bucket)
    await expect(page.getByText('Items: 1000')).toBeVisible()
    await page.getByLabel('Select all').check()
    await expect(page.getByText('1000 selected')).toBeVisible()
    await page.getByRole('button', { name: 'Load more' }).click()
    await expect(page.getByText('Items: 1003')).toBeVisible()
    await expect(page.getByText('No more items')).toBeVisible()
    // newly loaded rows are not selected: "select all" is indeterminate, and a click selects everything
    expect(await page.getByLabel('Select all').evaluate(el => el.indeterminate)).toBe(true)
    await page.getByLabel('Select all').click()
    await expect(page.getByText('1003 selected')).toBeVisible()
    await page.getByLabel('Select all').uncheck()
    await expect(page.getByText(/selected$/)).toHaveCount(0)
})
