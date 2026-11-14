import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate } from '../../src/helpers/format.js'
import { safeHttpUrl } from '../../src/helpers/url.js'
import { asciiFallbackName, contentDisposition } from '../../src/helpers/contentDisposition.js'
import { extOf, fileCategory, previewMode } from '../../src/helpers/mimeGuess.js'
import filterFilesByType from '../../src/helpers/filterFilesByType.js'
import { describeS3Error } from '../../src/api/s3Client.js'

describe('formatBytes', () => {
    it.each([
        [0, '0 B'], [1, '1 B'], [1023, '1023 B'], [1024, '1 KB'], [1536, '1.5 KB'],
        [5 * 1024 * 1024, '5 MB'], [1.25 * 1024 ** 3, '1.3 GB'], [-2048, '-2 KB'],
        [null, '-'], [undefined, '-'], [NaN, '-'],
    ])('%j -> %j', (n, s) => expect(formatBytes(n)).toBe(s))
    it('supports more decimals', () => expect(formatBytes(1.25 * 1024 ** 3, { decimals: 2 })).toBe('1.25 GB'))
})

describe('formatDate', () => {
    it('returns "-" for missing or invalid dates', () => {
        expect(formatDate(null)).toBe('-')
        expect(formatDate('not a date')).toBe('-')
        expect(formatDate(new Date(0))).not.toBe('-')
    })
})

describe('safeHttpUrl', () => {
    it.each([
        ['https://s3.amazonaws.com', true], ['http://localhost:9000', true], [' https://x.y/path ', true],
        ['javascript:alert(1)', false], ['data:text/html,x', false], ['ftp://x', false], ['//x.y', false],
        ['s3.amazonaws.com', false], ['', false], [null, false], [42, false], ['https://user:pw@x.y', false],
    ])('%j valid=%j', (v, ok) => expect(Boolean(safeHttpUrl(v))).toBe(ok))
})

describe('contentDisposition', () => {
    it('has an ASCII fallback and an RFC 5987 UTF-8 name', () => {
        const cd = contentDisposition('Résumé 日本.txt')
        expect(cd).toBe(`attachment; filename="Resume __.txt"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%E6%97%A5%E6%9C%AC.txt`)
    })
    it('escapes quotes, backslashes and RFC 5987 reserved characters', () => {
        expect(asciiFallbackName('a"b\\c')).toBe('a_b_c')
        expect(contentDisposition("it's (1)*.txt")).toContain("filename*=UTF-8''it%27s%20%281%29%2A.txt")
        expect(contentDisposition('line\nbreak')).not.toMatch(/\n/)
    })
})

describe('mimeGuess', () => {
    it('categorizes by extension', () => {
        expect(extOf('A.JPG')).toBe('jpg')
        expect(extOf('noext')).toBe('')
        expect(fileCategory('x.png')).toBe('image')
        expect(fileCategory('x.mp4')).toBe('video')
        expect(fileCategory('x.mp3')).toBe('audio')
        expect(fileCategory('x.zip')).toBe('archive')
        expect(fileCategory('x.js')).toBe('code')
        expect(fileCategory('x.pdf')).toBe('document')
        expect(fileCategory('x.md')).toBe('document')
        expect(fileCategory('x.unknown')).toBe('other')
    })
    it('maps files to preview modes', () => {
        expect(previewMode('a.json')).toBe('json')
        expect(previewMode('a.csv')).toBe('csv')
        expect(previewMode('a.md')).toBe('markdown')
        expect(previewMode('a.txt')).toBe('text')
        expect(previewMode('a.pdf')).toBe('pdf')
        expect(previewMode('a.bin')).toBe('download')
    })
    it('filters by type and drops folders', () => {
        const items = [{ type: 'folder', name: 'pics' }, { type: 'file', name: 'a.png' }, { type: 'file', name: 'b.txt' }]
        expect(filterFilesByType(items, 'image').map(i => i.name)).toEqual(['a.png'])
        expect(filterFilesByType(items, 'all')).toBe(items)
    })
})

describe('describeS3Error', () => {
    it('gives readable messages', () => {
        expect(describeS3Error({ name: 'AbortError' })).toBe('Canceled')
        expect(describeS3Error({ name: 'AccessDenied', message: 'Access Denied', $metadata: { httpStatusCode: 403 } })).toBe('Access denied: Access Denied')
        expect(describeS3Error(new TypeError('Failed to fetch'))).toMatch(/Network or CORS/)
        expect(describeS3Error({ name: 'NoSuchBucket', message: 'x' })).toBe('Bucket not found')
    })
})
