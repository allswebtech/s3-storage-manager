#!/usr/bin/env node
// Regenerates the README screenshots in docs/screenshots/ and docs/social-preview.png.
//   npm run screenshots
//
// What it does:
// 1. builds the app into a temporary folder (vite build, base '/');
// 2. starts a dedicated Versity Gateway container (not the test one) with AWS's documented example keys;
// 3. starts one local HTTPS server (self-signed certificate made with openssl) that serves the build for
//    https://files.example.com and reverse-proxies https://s3.eu-central-1.example.com to the container;
// 4. points Chromium at it with --host-resolver-rules, so every URL the UI shows (endpoint, signed links,
//    the CORS helper's origin) looks like a real deployment and nothing says localhost;
// 5. seeds the demo bucket "acme-media" with fixed content, captures each picture and cleans up.
// Needs Docker, openssl and the Playwright Chromium browser (npx playwright install chromium).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer as createHttpsServer } from 'node:https'
import { request as httpRequest } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { CreateBucketCommand, PutBucketCorsCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import createS3Client from '../src/api/s3Client.js'
import { SECURITY_HEADERS } from '../config/security-headers.js'
import { bytes } from '../test/integration/helpers.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'scripts', 'screenshots')
const OUT_DIR = join(ROOT, 'docs', 'screenshots')
const SOCIAL_OUT = join(ROOT, 'docs', 'social-preview.png')

const APP_HOST = 'files.example.com'
const S3_HOST = 's3.eu-central-1.example.com'
const APP_ORIGIN = `https://${APP_HOST}`
const ENDPOINT = `https://${S3_HOST}`
const REGION = 'eu-central-1'
// AWS's documented example credentials (https://docs.aws.amazon.com/IAM/latest/UserGuide/security-creds.html).
const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
const BUCKET = 'acme-media'
const OTHER_BUCKETS = ['acme-backups', 'acme-website']

const IMAGE = process.env.S3_IMAGE || 'versity/versitygw:v1.11.0'
const CONTAINER = 's3sm-screenshots'
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }

const KB = 1024
const MB = 1024 * KB

// ---------------------------------------------------------------- demo content

const README = `# Acme Media

Shared storage for the marketing team: brand assets, product
documents, photos and launch videos.

## Folders

| Folder       | What goes there                          |
|--------------|------------------------------------------|
| brand/       | Logos, colours and fonts                 |
| documents/   | Catalogs, price lists and contracts      |
| photos/      | Product and team photos (JPG, max 20 MB) |
| videos/      | Launch teasers and tutorials             |
| backups/     | Nightly exports, kept for 30 days        |

## Naming

Use lower-case names with dashes, e.g. spring-launch-hero.jpg.
`

const README_EDIT = `
## Launch checklist

- [x] Upload the 2026 product catalog
- [x] Refresh price-list.csv for Q4
- [ ] Replace launch-teaser.mp4 with the final cut
- [ ] Share the press kit with partners
`

const SITE_CONFIG = JSON.stringify({
    site: 'acme-website',
    cdn: { baseUrl: 'https://cdn.example.com/acme-media', cacheSeconds: 86400 },
    locales: ['en', 'de', 'fr'],
    features: { newsletter: true, darkMode: true, betaCatalog: false },
    contact: { email: 'hello@example.com' },
}, null, 2) + '\n'

function priceListCsv() {
    const products = ['Desk Lamp', 'Notebook A5', 'Water Bottle', 'Canvas Tote', 'Wireless Mouse', 'Mug 350 ml', 'Sticker Pack', 'Hoodie', 'Cap', 'Phone Stand']
    const lines = ['sku,product,variant,price_eur,stock']
    for (let i = 0; i < 420; i++) {
        const p = products[i % products.length]
        const variant = ['black', 'white', 'orange', 'grey', 'navy', 'sand'][i % 6]
        lines.push(`AC-${String(1000 + i)},${p},${variant},${(4.5 + ((i * 37) % 900) / 10).toFixed(2)},${(i * 53) % 480}`)
    }
    return lines.join('\n') + '\n'
}

/** Fixed-size binary body: a short, format-like header followed by deterministic noise. */
function blob(size, seed, header = '') {
    const b = bytes(size, seed)
    if (header) b.write(header, 0, 'latin1')
    return b
}

// key -> [body, contentType]; folders are implied by their objects.
function demoObjects(images) {
    return {
        'README.md': [README, 'text/markdown; charset=utf-8'],
        'product-catalog.pdf': [blob(Math.round(4.2 * MB), 11, '%PDF-1.7\n'), 'application/pdf'],
        'price-list.csv': [priceListCsv(), 'text/csv; charset=utf-8'],
        'site-config.json': [SITE_CONFIG, 'application/json'],
        'hero-landscape.jpg': [images.landscape, 'image/jpeg'],
        'launch-teaser.mp4': [blob(Math.round(24.6 * MB), 12, '\0\0\0 ftypmp42'), 'video/mp4'],
        'logo.svg': [images.logoSvg, 'image/svg+xml'],
        '2026-invoices.zip': [blob(Math.round(7.8 * MB), 13, 'PK\x03\x04'), 'application/zip'],
        'brand/acme-logo-dark.svg': [images.logoSvg, 'image/svg+xml'],
        'brand/colour-palette.json': ['{ "primary": "#f97316", "accent": "#f43f5e", "ink": "#15151a" }\n', 'application/json'],
        'brand/fonts/README.txt': ['Licensed fonts for the brand kit.\n', 'text/plain'],
        'documents/contracts/supplier-agreement.pdf': [blob(Math.round(1.3 * MB), 21, '%PDF-1.7\n'), 'application/pdf'],
        'documents/q3-report.pdf': [blob(Math.round(2.7 * MB), 22, '%PDF-1.7\n'), 'application/pdf'],
        'documents/meeting-notes.md': ['# Weekly sync\n\n- Catalog is final\n- Teaser cut due Friday\n', 'text/markdown'],
        'photos/team-offsite.jpg': [images.landscape, 'image/jpeg'],
        'photos/products/desk-lamp.jpg': [images.landscape, 'image/jpeg'],
        'videos/how-to-order.mp4': [blob(Math.round(11.4 * MB), 31, '\0\0\0 ftypmp42'), 'video/mp4'],
        'backups/2026-11-13-site.tar.gz': [blob(Math.round(3.6 * MB), 41, '\x1f\x8b'), 'application/gzip'],
    }
}

// ---------------------------------------------------------------- infrastructure

function log(msg) {
    console.log(`[screenshots] ${msg}`)
}

function freePort() {
    return new Promise((res, rej) => {
        const srv = createNetServer()
        srv.unref()
        srv.on('error', rej)
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address()
            srv.close(() => res(port))
        })
    })
}

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts })
    if (r.error) throw r.error
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}):\n${r.stdout || ''}${r.stderr || ''}`)
    return r.stdout
}

function buildApp(outDir) {
    return new Promise((res, rej) => {
        const p = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], {
            cwd: ROOT,
            stdio: 'inherit',
            env: { ...process.env, VITE_BASE_PATH: '/' },
        })
        p.on('error', rej)
        p.on('exit', code => (code === 0 ? res() : rej(new Error(`vite build exited with ${code}`))))
    })
}

function makeCertificate(dir) {
    const key = join(dir, 'key.pem')
    const cert = join(dir, 'cert.pem')
    run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2',
        '-subj', '/CN=example.com', '-addext', `subjectAltName=DNS:${APP_HOST},DNS:${S3_HOST}`])
    return { key: readFileSync(key), cert: readFileSync(cert) }
}

async function startS3Container(port) {
    spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
    run('docker', ['run', '-d', '--name', CONTAINER, '-p', `127.0.0.1:${port}:7070`,
        '-e', `ROOT_ACCESS_KEY=${ACCESS_KEY}`, '-e', `ROOT_SECRET_KEY=${SECRET_KEY}`,
        '-e', 'VGW_BACKEND=posix', '-e', 'VGW_BACKEND_ARG=/srv', '-e', `VGW_REGION=${REGION}`,
        '-e', `VGW_CORS_ALLOW_ORIGIN=${APP_ORIGIN}`, IMAGE])
    for (let i = 0; i < 100; i++) {
        try {
            await fetch(`http://127.0.0.1:${port}/`)
            return
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 200))
    }
    throw new Error(`S3 container did not start:\n${spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8' }).stderr}`)
}

function stopS3Container() {
    spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
}

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2',
}

/** One HTTPS server: the built app for APP_HOST (SPA fallback, production headers), a proxy to S3 for S3_HOST. */
function startFrontServer({ port, distDir, s3Port, tls }) {
    const root = resolve(distDir)
    const server = createHttpsServer(tls, (req, res) => {
        const host = String(req.headers.host || '').replace(/:\d+$/, '')
        if (host === S3_HOST) {
            const up = httpRequest({ host: '127.0.0.1', port: s3Port, method: req.method, path: req.url, headers: req.headers }, (r) => {
                res.writeHead(r.statusCode, r.headers)
                r.pipe(res)
            })
            up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
            req.on('aborted', () => up.destroy())
            req.pipe(up)
            return
        }
        if (host !== APP_HOST) {
            res.writeHead(404)
            return res.end()
        }
        const url = new URL(req.url, APP_ORIGIN)
        let file = normalize(join(root, decodeURIComponent(url.pathname)))
        if (!file.startsWith(root)) {
            res.writeHead(403)
            return res.end()
        }
        if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' })
        res.end(readFileSync(file))
    })
    return new Promise((res, rej) => {
        server.on('error', rej)
        server.listen(port, '127.0.0.1', () => res(server))
    })
}

async function seedBucket(s3Port, images) {
    const s3 = createS3Client({ endpoint: `http://127.0.0.1:${s3Port}`, region: REGION, access_key: ACCESS_KEY, secret_key: SECRET_KEY })
    try {
        for (const name of [BUCKET, ...OTHER_BUCKETS]) {
            await s3.send(new CreateBucketCommand({ Bucket: name }))
            await s3.send(new PutBucketCorsCommand({
                Bucket: name,
                CORSConfiguration: {
                    CORSRules: [{
                        AllowedHeaders: ['*'],
                        AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                        AllowedOrigins: [APP_ORIGIN],
                        ExposeHeaders: ['ETag'],
                        MaxAgeSeconds: 3000,
                    }],
                },
            }))
        }
        for (const [key, [body, ContentType]] of Object.entries(demoObjects(images))) {
            await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType }))
        }
        await s3.send(new PutObjectCommand({ Bucket: 'acme-website', Key: 'index.html', Body: '<!doctype html><title>Acme</title>\n', ContentType: 'text/html' }))
        await s3.send(new PutObjectCommand({ Bucket: 'acme-backups', Key: 'db/2026-11-13.sql.gz', Body: blob(512 * KB, 51, '\x1f\x8b'), ContentType: 'application/gzip' }))
    } finally {
        s3.destroy()
    }
}

// ---------------------------------------------------------------- browser helpers

function credential(name) {
    return { name, access_key: ACCESS_KEY, secret_key: SECRET_KEY, region: REGION, endpoint: ENDPOINT }
}

const ALL_CREDENTIALS = [credential(BUCKET), credential(OTHER_BUCKETS[0]), credential(OTHER_BUCKETS[1])]

async function newPage(browser, device, { credentials = ALL_CREDENTIALS, clock = false } = {}) {
    const context = await browser.newContext({ ...device, ignoreHTTPSErrors: true, colorScheme: 'dark', locale: 'en-US', timezoneId: 'Europe/Berlin' })
    const page = await context.newPage()
    const problems = []
    page.on('pageerror', e => problems.push(`pageerror: ${e.message}`))
    page.on('console', m => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`) })
    if (clock) await page.clock.install()
    if (credentials) {
        await page.addInitScript(([list]) => {
            if (!sessionStorage.getItem('__seeded')) {
                localStorage.setItem('credentials', JSON.stringify(list))
                localStorage.setItem('selectedCredentialIndex', '0')
                sessionStorage.setItem('__seeded', '1')
            }
        }, [credentials])
    }
    page.problems = problems
    return page
}

async function closePage(page) {
    const ctx = page.context()
    page.removeAllListeners('console')
    page.removeAllListeners('pageerror')
    await ctx.close()
}

async function openBucket(page) {
    await page.goto(`${APP_ORIGIN}/`)
    await page.getByRole('heading', { name: new RegExp(BUCKET) }).waitFor()
    await page.getByTestId('finder-row').first().waitFor()
    await settle(page)
}

function row(page, name) {
    return page.getByTestId('finder-row').filter({ has: page.getByRole('button', { name, exact: true }) })
}

async function rowAction(page, name, action) {
    await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click()
    await page.getByRole('menuitem', { name: action, exact: true }).click()
}

/** Fonts loaded, no spinner, no "Loading…"/"Generating", every image decoded, no toast on screen. */
async function settle(page, { allowSpinner = false } = {}) {
    await page.evaluate(() => document.fonts.ready)
    if (!allowSpinner) await page.waitForFunction(() => !document.querySelector('.animate-spin, [aria-label="Loading"]'))
    await page.waitForFunction(() => !/Loading…|Generating URLs|Calculating…/.test(document.body.innerText))
    await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0))
    await page.waitForFunction(() => !document.querySelector('.Toastify__toast'), null, { timeout: 15_000 })
    // Clips are computed from bounding boxes (viewport coordinates), so captures start at the top.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.mouse.move(2, 2)
    await page.waitForTimeout(150)
}

async function box(locator) {
    const b = await locator.boundingBox()
    if (!b) throw new Error(`no bounding box for ${locator}`)
    return b
}

/** Clip rectangle around a set of boxes, padded and kept inside the page. */
async function clipAround(page, boxes, { padX = 32, padTop = 24, padBottom = 24, top, bottom } = {}) {
    const { w, h } = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }))
    const x0 = Math.max(0, Math.min(...boxes.map(b => b.x)) - padX)
    const x1 = Math.min(w, Math.max(...boxes.map(b => b.x + b.width)) + padX)
    const y0 = Math.max(0, top ?? Math.min(...boxes.map(b => b.y)) - padTop)
    const y1 = Math.min(h, bottom ?? Math.max(...boxes.map(b => b.y + b.height)) + padBottom)
    return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) }
}

async function shoot(page, name, clip) {
    const errorToasts = await page.locator('.Toastify__toast--error').count()
    if (errorToasts) throw new Error(`${name}: an error toast is on screen`)
    if (page.problems.length) throw new Error(`${name}: browser errors:\n${page.problems.join('\n')}`)
    const path = join(OUT_DIR, name)
    // Full-page mode only when the clip goes below the viewport: it resizes the viewport, which would
    // move fixed dialogs.
    const fullPage = Boolean(clip) && clip.y + clip.height > page.viewportSize().height
    await page.screenshot({ path, ...(clip && { clip, fullPage }), animations: 'disabled', caret: 'hide', scale: 'device' })
    log(`${name} ${clip ? `${clip.width}x${clip.height} css px` : 'viewport'} -> ${(statSync(path).size / KB).toFixed(0)} KB`)
}

const card = (page) => page.locator('.card').first()

// ---------------------------------------------------------------- the pictures

async function fileBrowser(browser) {
    const page = await newPage(browser, DESKTOP)
    await openBucket(page)
    const c = await box(card(page))
    await shoot(page, 'file-browser.png', await clipAround(page, [c], { top: 0 }))
    await closePage(page)
}

async function bulkActions(browser) {
    const page = await newPage(browser, DESKTOP)
    await openBucket(page)
    for (const n of ['photos', 'product-catalog.pdf', 'price-list.csv']) await row(page, n).getByRole('checkbox').check()
    await page.getByText('3 selected').waitFor()
    await settle(page)
    const c = await box(card(page))
    const last = await box(row(page, 'hero-landscape.jpg'))
    await shoot(page, 'bulk-actions.png', await clipAround(page, [c], { top: 0, bottom: last.y + last.height + 1 }))
    await closePage(page)
}

async function filePreviewImage(browser) {
    const page = await newPage(browser, DESKTOP)
    await openBucket(page)
    await page.getByRole('button', { name: 'hero-landscape.jpg', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('img').waitFor()
    await settle(page)
    await shoot(page, 'preview-image.png', await clipAround(page, [await box(dialog)], { padX: 16, padTop: 16, padBottom: 16 }))
    await closePage(page)
}

async function editText(browser) {
    const page = await newPage(browser, DESKTOP)
    await openBucket(page)
    await page.getByRole('button', { name: 'README.md', exact: true }).click()
    const area = page.getByRole('textbox', { name: 'Contents of README.md' })
    await area.waitFor()
    await area.fill(README + README_EDIT)
    await area.evaluate(el => { el.setSelectionRange(0, 0); el.scrollTop = 0; el.blur() })
    const save = page.getByRole('button', { name: 'Save', exact: true })
    if (!(await save.isEnabled())) throw new Error('Save is not enabled after editing')
    await settle(page)
    await shoot(page, 'edit-text.png', await clipAround(page, [await box(page.getByRole('dialog'))], { padX: 16, padTop: 16, padBottom: 16 }))
    await closePage(page)
}

async function fileDetails(browser) {
    const page = await newPage(browser, DESKTOP)
    await openBucket(page)
    await page.getByRole('button', { name: 'Details of product-catalog.pdf', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'View URL' }).waitFor()
    await settle(page)
    await shoot(page, 'file-details.png', await clipAround(page, [await box(dialog)], { padX: 48, padTop: 40, padBottom: 40 }))
    await closePage(page)
}

async function moveCopy(browser) {
    const page = await newPage(browser, DESKTOP)
    await openBucket(page)
    await rowAction(page, 'product-catalog.pdf', 'Move to…')
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Destination path or folder').fill('documents/catalogs/')
    await dialog.getByLabel('On conflict').selectOption('rename')
    await page.evaluate(() => document.activeElement?.blur())
    await settle(page)
    await shoot(page, 'move-copy.png', await clipAround(page, [await box(dialog)], { padX: 48, padTop: 40, padBottom: 40 }))
    await closePage(page)
}

async function multipleBuckets(browser) {
    const page = await newPage(browser, DESKTOP)
    await openBucket(page)
    await page.getByRole('button', { name: /Switch credential/ }).click()
    const list = page.getByRole('listbox', { name: 'Saved credentials' })
    await list.waitFor()
    await page.mouse.move(2, 2)
    await page.waitForTimeout(150)
    const c = await box(card(page))
    const l = await box(list)
    await shoot(page, 'multiple-buckets.png', await clipAround(page, [c], { top: 0, bottom: Math.max(l.y + l.height, c.y) + 260 }))
    await closePage(page)
}

async function addBucket(browser) {
    const page = await newPage(browser, DESKTOP)
    await page.goto(`${APP_ORIGIN}/config`)
    await page.getByRole('button', { name: 'DigitalOcean Spaces', exact: true }).click()
    await page.getByLabel('Access Key').fill(ACCESS_KEY)
    await page.getByLabel('Secret Key').fill(SECRET_KEY)
    await page.getByLabel('Region').fill('nyc3')
    await page.getByLabel('Bucket Name').fill('acme-website')
    await page.getByLabel('Endpoint').fill('https://nyc3.digitaloceanspaces.com')
    await page.evaluate(() => document.activeElement?.blur())
    await settle(page)
    const cards = page.locator('.card')
    const form = await box(cards.nth(0))
    const providers = await box(cards.nth(1))
    // The CORS helper below the chosen provider makes the page ~1600 px tall; it is left out so the
    // picture stays readable in a README (the form and the chosen preset are the point here).
    const preset = await box(page.locator('.card-2').first())
    await shoot(page, 'add-bucket.png', await clipAround(page, [form, providers], { top: form.y - 28, padX: 40, bottom: preset.y + preset.height + 16 }))
    await closePage(page)
}

async function mobile(browser) {
    const page = await newPage(browser, MOBILE)
    await openBucket(page)
    await shoot(page, 'mobile.png', null)
    await closePage(page)
}

/**
 * Upload queue mid-flight: one conflict, one finished, one large file held at 3 of 8 parts, one waiting
 * (a fifth row would be cut by the queue's scroll area).
 * Part requests above 3 are held by request routing, and the page clock is paused so the finished row is
 * not removed by its 1.5 s timer before the capture.
 */
async function uploadQueue(browser, workDir) {
    const page = await newPage(browser, DESKTOP, { clock: true })
    const held = []
    await page.route(`${ENDPOINT}/**`, async (route) => {
        const url = new URL(route.request().url())
        const part = Number(url.searchParams.get('partNumber') || 0)
        if (route.request().method() === 'PUT' && url.pathname.endsWith('/product-demo.mp4') && part > 3) {
            held.push(route)
            return
        }
        await route.continue()
    })
    await openBucket(page)
    await page.clock.pauseAt(Date.now() + 1000)
    // Real files on disk (setInputFiles caps in-memory buffers at 50 MB in total).
    const dir = join(workDir, 'uploads')
    mkdirSync(dir, { recursive: true })
    const uploads = {
        'price-list.csv': priceListCsv(),
        'brand-guidelines.pdf': blob(Math.round(2.4 * MB), 61, '%PDF-1.7\n'),
        'product-demo.mp4': blob(38 * MB, 62, '\0\0\0 ftypmp42'),
        'press-kit.zip': blob(Math.round(12.3 * MB), 63, 'PK\x03\x04'),
    }
    for (const [n, body] of Object.entries(uploads)) writeFileSync(join(dir, n), body)
    await page.getByTestId('file-input').setInputFiles(Object.keys(uploads).map(n => join(dir, n)))
    const item = (n) => page.locator(`[data-testid="upload-item"][data-name="${n}"]`)
    await item('price-list.csv').and(page.locator('[data-status="conflict"]')).waitFor({ timeout: 60_000 })
    await item('brand-guidelines.pdf').and(page.locator('[data-status="done"]')).waitFor({ timeout: 60_000 })
    await item('product-demo.mp4').getByText('39%').waitFor({ timeout: 60_000 })
    await settle(page, { allowSpinner: true })
    const c = await box(card(page))
    const dropper = await box(page.getByTestId('file-dropper'))
    await shoot(page, 'upload-queue.png', await clipAround(page, [c], { top: 0, bottom: dropper.y + dropper.height + 16 }))
    for (const r of held) await r.abort().catch(() => {})
    await closePage(page)
}

async function socialPreview(browser, appLogo) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 })
    const shot = readFileSync(join(OUT_DIR, 'file-browser.png')).toString('base64')
    const html = readFileSync(join(ASSETS, 'social-preview.html'), 'utf8')
        .replace('{{SCREENSHOT}}', `data:image/png;base64,${shot}`)
        .replace('{{LOGO}}', `data:image/svg+xml;base64,${Buffer.from(appLogo).toString('base64')}`)
    await page.setContent(html, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0))
    await page.screenshot({ path: SOCIAL_OUT, animations: 'disabled' })
    log(`social-preview.png 1280x640 -> ${(statSync(SOCIAL_OUT).size / KB).toFixed(0)} KB`)
    await page.close()
}

/** The demo JPEG: the SVG illustration rendered by Chromium (deterministic for one browser build). */
async function renderLandscape(browser) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
    const svg = readFileSync(join(ASSETS, 'landscape.svg'), 'utf8')
    await page.setContent(`<!doctype html><style>html,body{margin:0}svg{display:block}</style>${svg}`)
    const jpg = await page.screenshot({ type: 'jpeg', quality: 90 })
    await page.close()
    return jpg
}

// ---------------------------------------------------------------- main

async function main() {
    const work = mkdtempSync(join(tmpdir(), 's3sm-shots-'))
    const cleanups = []
    const cleanup = async () => {
        while (cleanups.length) {
            try { await cleanups.pop()() } catch { /* keep cleaning */ }
        }
        rmSync(work, { recursive: true, force: true })
    }
    let interrupted = false
    for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, () => {
            if (interrupted) return
            interrupted = true
            cleanup().finally(() => process.exit(130))
        })
    }

    try {
        log('building the app')
        const dist = join(work, 'dist')
        await buildApp(dist)

        const s3Port = await freePort()
        log(`starting S3 container ${CONTAINER}`)
        cleanups.push(stopS3Container)
        await startS3Container(s3Port)

        const frontPort = await freePort()
        const server = await startFrontServer({ port: frontPort, distDir: dist, s3Port, tls: makeCertificate(work) })
        cleanups.push(() => new Promise(r => { server.closeAllConnections(); server.close(() => r()) }))

        const browser = await chromium.launch({
            args: [
                `--host-resolver-rules=MAP ${APP_HOST} 127.0.0.1:${frontPort},MAP ${S3_HOST} 127.0.0.1:${frontPort}`,
                '--ignore-certificate-errors',
                '--font-render-hinting=none',
            ],
        })
        cleanups.push(() => browser.close())

        const logoSvg = readFileSync(join(ASSETS, 'brand-logo.svg'), 'utf8')
        const appLogo = readFileSync(join(ROOT, 'public', 'logo.svg'), 'utf8')
        const images = { landscape: await renderLandscape(browser), logoSvg }
        log('seeding the demo bucket')
        await seedBucket(s3Port, images)

        mkdirSync(OUT_DIR, { recursive: true })
        const only = process.argv.slice(2)
        const jobs = { fileBrowser, bulkActions, filePreviewImage, editText, fileDetails, moveCopy, multipleBuckets, addBucket, mobile }
        // Read-only pictures run side by side; the upload one changes the bucket, so it runs last.
        await Promise.all(Object.entries(jobs).filter(([n]) => !only.length || only.includes(n)).map(([, fn]) => fn(browser)))
        if (!only.length || only.includes('uploadQueue')) await uploadQueue(browser, work)
        if (!only.length || only.includes('socialPreview')) await socialPreview(browser, appLogo)
        log('done')
    } finally {
        await cleanup()
    }
}

main().catch((err) => {
    console.error(err)
    process.exitCode = 1
})

