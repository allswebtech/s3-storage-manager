import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CSP_HEADER, CSP_META, HEADER_ONLY_DIRECTIVES, SECURITY_HEADERS } from '../../config/security-headers.js'
import { renderHtaccess, renderVercelJson } from '../../scripts/sync-headers.mjs'
import { normalizeBase } from '../../vite.config.js'

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('security headers: one source of truth', () => {
    it('vercel.json and public/.htaccess are generated from config/security-headers.js (run npm run headers)', () => {
        expect(read('vercel.json')).toBe(renderVercelJson())
        expect(read('public/.htaccess')).toBe(renderHtaccess())
    })

    it('all three carry the same CSP; header-only directives are not in the meta tag', () => {
        const vercel = JSON.parse(read('vercel.json'))
        const vercelCsp = vercel.headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy').value
        expect(vercelCsp).toBe(CSP_HEADER)
        expect(read('public/.htaccess')).toContain(`Content-Security-Policy "${CSP_HEADER}"`)
        expect(CSP_HEADER.startsWith(CSP_META)).toBe(true)
        for (const [name] of HEADER_ONLY_DIRECTIVES) {
            expect(CSP_META).not.toContain(name)
            expect(CSP_HEADER).toContain(name)
        }
    })

    it('has a strict script policy and the required headers', () => {
        expect(CSP_META).toMatch(/script-src 'self'(;|$)/)
        expect(CSP_META).not.toMatch(/unsafe-eval/)
        expect(CSP_META).toContain("object-src 'none'")
        expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff')
        expect(SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer')
        expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY')
        expect(SECURITY_HEADERS['Permissions-Policy']).toBeTruthy()
    })

    it('vercel.json keeps the SPA fallback and long-caches hashed assets', () => {
        const vercel = JSON.parse(read('vercel.json'))
        expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }])
        const assets = vercel.headers.find(h => h.source === '/assets/(.*)')
        expect(assets.headers[0].value).toMatch(/immutable/)
    })
})

describe('normalizeBase', () => {
    it.each([[undefined, '/'], ['', '/'], ['/', '/'], ['//', '/'], ['/x//', '/x/'], ['//x/y//', '/x/y/'], ['s3-storage-manager', '/s3-storage-manager/'], ['/x/y', '/x/y/'], ['/x/', '/x/']])('%j -> %j', (v, want) => {
        expect(normalizeBase(v)).toBe(want)
    })
})
