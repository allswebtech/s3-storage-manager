import { test, expect, credentialFor, listKeys, row, rowAction } from './fixtures.js'

test('add credential, list, upload, delete', async ({ page, s3, bucket, problems }) => {
    void problems
    await page.goto('./')
    // No credentials yet: the app redirects to the configuration page.
    await expect(page).toHaveURL(/\/config$/)
    const cred = credentialFor(bucket)
    await page.getByLabel('Access Key').fill(cred.access_key)
    await page.getByLabel('Secret Key').fill(cred.secret_key)
    await page.getByLabel('Region').fill(cred.region)
    await page.getByLabel('Bucket Name').fill(cred.name)
    await page.getByLabel('Endpoint').fill(cred.endpoint)
    await page.getByRole('button', { name: 'Connect' }).click()

    await expect(page.getByText('No files or folders in this directory.')).toBeVisible()
    await expect(page.getByRole('heading', { name: new RegExp(bucket) })).toBeVisible()

    await page.getByTestId('file-input').setInputFiles({ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hello world') })
    await expect(row(page, 'hello.txt')).toBeVisible()
    expect(await listKeys(s3, bucket)).toEqual(['hello.txt'])

    await rowAction(page, 'hello.txt', 'Delete')
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('No files or folders in this directory.')).toBeVisible()
    expect(await listKeys(s3, bucket)).toEqual([])
})
