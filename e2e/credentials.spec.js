import { test, expect, credentialFor, seedCredentials, putObject, row } from './fixtures.js'
import { createBucket, uniqueBucketName } from '../test/s3-env.js'
import { APP_ORIGINS } from './fixtures.js'

test('second credential, switch, edit, remove one, reload keeps state', async ({ page, s3, bucket, problems }) => {
    void problems
    const second = await createBucket(s3, uniqueBucketName('e2e2'), { cors: APP_ORIGINS })
    await putObject(s3, bucket, 'first/f.txt', '1')
    await putObject(s3, second, 'in-second.txt', '2')
    await seedCredentials(page, [credentialFor(bucket)])
    await page.goto('./')
    await page.getByRole('button', { name: 'first', exact: true }).click()
    await expect(row(page, 'f.txt')).toBeVisible()

    // add a second credential through the form: it becomes the selected one
    await page.getByRole('button', { name: /Switch credential/ }).click()
    await page.getByRole('button', { name: '+ Add Credential' }).click()
    await expect(page).toHaveURL(/\/config$/)
    const c = credentialFor(second)
    await page.getByLabel('Endpoint').fill('not a url')
    await page.getByLabel('Access Key').fill(c.access_key)
    await page.getByLabel('Secret Key').fill(c.secret_key)
    await page.getByLabel('Region').fill(c.region)
    await page.getByLabel('Bucket Name').fill(c.name)
    await page.getByRole('button', { name: 'Connect' }).click()
    await expect(page.getByText('Must be an http:// or https:// URL')).toBeVisible()
    await page.getByLabel('Endpoint').fill(c.endpoint)
    await page.getByRole('button', { name: 'Connect' }).click()
    await expect(row(page, 'in-second.txt')).toBeVisible()

    // switch back: lands in the folder last used in the first bucket
    await page.getByRole('button', { name: /Switch credential/ }).click()
    await page.getByRole('option', { name: bucket }).click()
    await expect(row(page, 'f.txt')).toBeVisible()

    // reload keeps the selected credential and folder
    await page.reload()
    await expect(row(page, 'f.txt')).toBeVisible()
    await expect(page.getByRole('button', { name: /Switch credential/ })).toContainText(bucket)

    // edit: set a public URL
    await page.getByRole('button', { name: 'Edit Credential' }).click()
    await page.getByLabel('Public Base URL (optional)').fill('https://cdn.example.com/files')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Credentials updated!')).toBeVisible()
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('credentials')))
    expect(stored.map(s => s.name)).toEqual([bucket, second])
    expect(stored[0].publicUrl).toBe('https://cdn.example.com/files')

    // remove the first credential: the second one remains and is selected
    page.once('dialog', d => d.accept())
    await page.getByRole('button', { name: 'Edit Credential' }).click()
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(row(page, 'in-second.txt')).toBeVisible()
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('credentials')))
    expect(after.map(s => s.name)).toEqual([second])

    // disconnect asks first; cancel keeps everything
    page.once('dialog', d => d.dismiss())
    await page.getByRole('button', { name: 'Disconnect' }).click()
    await expect(row(page, 'in-second.txt')).toBeVisible()
    page.once('dialog', d => d.accept())
    await page.getByRole('button', { name: 'Disconnect' }).click()
    await expect(page).toHaveURL(/\/config$/)
    expect(await page.evaluate(() => localStorage.getItem('credentials'))).toBeNull()
})

test('existing users: legacy single-object credential and legacy currentDirectory still work', async ({ page, s3, bucket, problems }) => {
    void problems
    await putObject(s3, bucket, 'legacy/dir/file.txt', 'x')
    await page.addInitScript(([cred]) => {
        if (!sessionStorage.getItem('__seeded')) {
            localStorage.setItem('credentials', JSON.stringify(cred)) // pre-array shape
            localStorage.setItem('currentDirectory', '/legacy/dir')
            sessionStorage.setItem('__seeded', '1')
        }
    }, [credentialFor(bucket)])
    await page.goto('./')
    await expect(row(page, 'file.txt')).toBeVisible()
})

test('deep link to /config and unknown paths load the app', async ({ page, bucket, problems }) => {
    void problems
    await seedCredentials(page, [credentialFor(bucket)])
    await page.goto('./config')
    await expect(page.getByRole('heading', { name: 'Enter your S3 Configurations' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Enter your S3 Configurations' })).toBeVisible()
    await page.goto('./some/unknown/route')
    await expect(page.getByRole('heading', { name: new RegExp(bucket) })).toBeVisible()
    // logo is served from the right base path
    const logo = await page.locator('img[src$="logo.svg"]').first().evaluate(img => ({ ok: img.complete && img.naturalWidth > 0, src: img.src }))
    expect(logo.ok).toBe(true)
})
