import { describe, expect, it } from 'vitest'
import { baseName, encodeCopySource, encodeKeyPath, numberedKey, parentPrefix, resolveDestination, splitExt, stripPrefix, toPrefix, toUiPath, validateName } from '../../src/helpers/keys.js'

describe('toPrefix / toUiPath', () => {
    it.each([
        ['', ''], ['/', ''], ['//', ''], [null, ''], [undefined, ''],
        ['a', 'a/'], ['/a', 'a/'], ['a/', 'a/'], ['/a/b/', 'a/b/'], ['//a/b//', 'a/b/'], [' /a ', 'a/'],
    ])('%j -> %j', (input, want) => {
        expect(toPrefix(input)).toBe(want)
    })
    it('round-trips UI paths in the legacy localStorage shape', () => {
        expect(toUiPath('')).toBe('/')
        expect(toUiPath('a/b/')).toBe('/a/b/')
        expect(toPrefix(toUiPath('x y/$&/'))).toBe('x y/$&/')
    })
})

describe('stripPrefix', () => {
    it('removes only a leading prefix and never interprets $ patterns', () => {
        expect(stripPrefix('a/b/c.txt', 'a/b/')).toBe('c.txt')
        expect(stripPrefix('x/a/b/', 'a/b/')).toBe('x/a/b/')
        expect(stripPrefix('$&/$1.txt', '$&/')).toBe('$1.txt')
        expect(stripPrefix('a/a/a.txt', 'a/')).toBe('a/a.txt')
        expect(stripPrefix('k', '')).toBe('k')
    })
})

describe('baseName / parentPrefix / splitExt', () => {
    it('handles files and folders', () => {
        expect(baseName('a/b/c.txt')).toBe('c.txt')
        expect(baseName('a/b/')).toBe('b')
        expect(baseName('')).toBe('')
        expect(parentPrefix('a/b/c.txt')).toBe('a/b/')
        expect(parentPrefix('a/b/')).toBe('a/')
        expect(parentPrefix('top.txt')).toBe('')
        expect(splitExt('a.tar.gz')).toEqual(['a.tar', '.gz'])
        expect(splitExt('.env')).toEqual(['.env', ''])
        expect(splitExt('noext')).toEqual(['noext', ''])
        expect(splitExt('trailing.')).toEqual(['trailing.', ''])
    })
})

describe('numberedKey', () => {
    it('inserts the counter before the extension, for files and folders', () => {
        expect(numberedKey('dir/photo.jpg', 1)).toBe('dir/photo (1).jpg')
        expect(numberedKey('README', 2)).toBe('README (2)')
        expect(numberedKey('a/folder/', 3)).toBe('a/folder (3)/')
    })
})

describe('encodeCopySource / encodeKeyPath', () => {
    it('encodes every URL-special character of each segment but keeps "/"', () => {
        expect(encodeCopySource('bkt', 'a b/c+d&e?f#g%h$&;ü.txt')).toBe('bkt/a%20b/c%2Bd%26e%3Ff%23g%25h%24%26%3B%C3%BC.txt')
        expect(encodeKeyPath('x/y z')).toBe('x/y%20z')
    })
})

describe('validateName', () => {
    it.each([
        ['', /empty/], ['   ', /empty/], [' a', /spaces/], ['a ', /spaces/], ['a/b', /"\/"/],
        ['.', /"\."/], ['..', /"\."/], ['a\u0001b', /control/], ['x'.repeat(1100), /too long/],
    ])('rejects %j', (name, msg) => {
        expect(validateName(name)).toMatch(msg)
    })
    it('accepts ordinary and unusual-but-valid names', () => {
        for (const n of ['report.pdf', 'with space.txt', '$&.txt', 'ünï 日本', '.env', 'a+b#c?d']) expect(validateName(n)).toBe('')
        expect(validateName('docs', { type: 'folder' })).toBe('')
    })
    it('labels folder errors as folder errors', () => {
        expect(validateName('', { type: 'folder' })).toMatch(/^Folder name/)
    })
})

describe('resolveDestination (move/copy target)', () => {
    const file = { type: 'file', key: 'a/report.pdf' }
    const folder = { type: 'folder', key: 'a/sub/' }
    it('treats empty, trailing slash and extension-less paths as folders', () => {
        expect(resolveDestination(file, '')).toBe('report.pdf')
        expect(resolveDestination(file, 'b/')).toBe('b/report.pdf')
        expect(resolveDestination(file, '/b/c')).toBe('b/c/report.pdf')
        expect(resolveDestination(folder, 'b')).toBe('b/sub/')
        expect(resolveDestination(folder, '')).toBe('sub/')
    })
    it('treats a path with an extension as the new file key', () => {
        expect(resolveDestination(file, 'b/new.pdf')).toBe('b/new.pdf')
        expect(resolveDestination(file, 'new.pdf')).toBe('new.pdf')
    })
})
