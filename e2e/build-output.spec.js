import { existsSync, readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { CSP_META } from '../config/security-headers.js'

// Checks on the production build folders the two web servers serve.
test('default build ships .htaccess and the CSP meta tag', async ({}, testInfo) => { // eslint-disable-line no-empty-pattern
    test.skip(testInfo.project.name !== 'default', 'default build only')
    expect(existsSync('dist/.htaccess')).toBe(true)
    const html = readFileSync('dist/index.html', 'utf8')
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${CSP_META}" />`)
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/) // no inline scripts
    expect(html).toContain('href="/logo.svg"')
})

test('pages build has 404.html identical to index.html, .nojekyll and sub-path assets', async ({}, testInfo) => { // eslint-disable-line no-empty-pattern
    test.skip(testInfo.project.name !== 'pages', 'pages build only')
    const index = readFileSync('dist-pages/index.html', 'utf8')
    expect(readFileSync('dist-pages/404.html', 'utf8')).toBe(index)
    expect(existsSync('dist-pages/.nojekyll')).toBe(true)
    expect(index).toContain('href="/s3-storage-manager/logo.svg"')
    expect(index).toMatch(/src="\/s3-storage-manager\/assets\/index-[^"]+\.js"/)
    expect(index).toContain(`content="${CSP_META}"`)
})

test('served index page carries the CSP meta tag', async ({ request, baseURL }) => {
    const res = await request.get(baseURL)
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('http-equiv="Content-Security-Policy"')
})
