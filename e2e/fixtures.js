import { test as base, expect } from '@playwright/test'
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import { S3_ENV, createBucket, testClient, uniqueBucketName } from '../test/s3-env.js'

export { expect }

// Origins the e2e servers run on; the test bucket's CORS rule allows exactly these.
export const APP_ORIGINS = ['http://localhost:4173', 'http://localhost:4174']

export const test = base.extend({
    s3: async ({}, use) => { // eslint-disable-line no-empty-pattern
        const s3 = testClient()
        await use(s3)
        s3.destroy()
    },

    bucket: async ({ s3 }, use) => {
        const name = await createBucket(s3, uniqueBucketName('e2e'), { cors: APP_ORIGINS })
        await use(name)
    },

    // Collects console errors, uncaught exceptions, unhandled rejections and CSP violations; any of them
    // fails the test after it ran.
    problems: async ({ page }, use) => {
        const problems = []
        await page.addInitScript(() => {
            document.addEventListener('securitypolicyviolation', (e) => {
                console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`)
            })
            window.addEventListener('unhandledrejection', (e) => {
                console.error(`Unhandled rejection: ${e.reason && (e.reason.stack || e.reason.message || e.reason)}`)
            })
        })
        const consoleErrors = []
        const fallbackDocuments = new Set()
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push({ text: msg.text(), url: msg.location()?.url || '' })
        })
        page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
        page.on('response', (res) => {
            // Any failed request for an app asset (wrong base path, missing logo...) is a defect.
            // A 404 *document* is the GitHub Pages SPA fallback (404.html) and is expected.
            const url = res.url()
            if (res.status() >= 400 && /localhost:417[34]/.test(url)) {
                if (res.status() === 404 && res.request().resourceType() === 'document') fallbackDocuments.add(url)
                else problems.push(`HTTP ${res.status()} ${url}`)
            }
        })
        await use(problems)
        for (const e of consoleErrors) {
            // Chrome logs the 404 status of a Pages 404.html fallback document; that one is by design.
            if (/Failed to load resource: the server responded with a status of 404/.test(e.text) && fallbackDocuments.has(e.url)) continue
            problems.push(`console.error: ${e.text}${e.url ? ` (${e.url})` : ''}`)
        }
        expect(problems, 'console errors / CSP violations / failed asset requests').toEqual([])
    },
})

export function credentialFor(bucket, extra = {}) {
    return { name: bucket, access_key: S3_ENV.access_key, secret_key: S3_ENV.secret_key, region: S3_ENV.region, endpoint: S3_ENV.endpoint, ...extra }
}

/** Seed saved credentials as an existing user would have them (raw localStorage). */
export async function seedCredentials(page, list, selectedIndex = 0) {
    await page.addInitScript(([l, i]) => {
        if (!sessionStorage.getItem('__seeded')) {
            localStorage.setItem('credentials', JSON.stringify(l))
            localStorage.setItem('selectedCredentialIndex', String(i))
            sessionStorage.setItem('__seeded', '1')
        }
    }, [list, selectedIndex])
}

export async function putObject(s3, bucket, key, body = '', contentType) {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ...(contentType && { ContentType: contentType }) }))
}

export async function getText(s3, bucket, key) {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return { text: await res.Body.transformToString(), contentType: res.ContentType }
}

export async function getBytes(s3, bucket, key) {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return Buffer.from(await res.Body.transformToByteArray())
}

export async function listKeys(s3, bucket, prefix = '') {
    const keys = []
    let token
    do {
        const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }))
        for (const o of res.Contents || []) keys.push(o.Key)
        token = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (token)
    return keys.sort()
}

export function row(page, name) {
    return page.getByTestId('finder-row').filter({ has: page.getByRole('button', { name, exact: true }) })
}

/** Open the "⋮" menu of a row and click one of its actions. */
export async function rowAction(page, name, action) {
    await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click()
    await page.getByRole('menuitem', { name: action, exact: true }).click()
}

/** Open the app with one saved credential (as an existing user) and wait for the listing. */
export async function openWithCredential(page, bucket, extra = {}) {
    await seedCredentials(page, [credentialFor(bucket, extra)])
    await page.goto('./')
    await expect(page.getByRole('heading', { name: new RegExp(bucket) })).toBeVisible()
    await expect(page.getByLabel('Loading')).toHaveCount(0)
}

export async function uploadFiles(page, files) {
    await page.getByTestId('file-input').setInputFiles(files)
}

export function uploadItem(page, name) {
    return page.locator(`[data-testid="upload-item"][data-name="${name}"]`)
}
