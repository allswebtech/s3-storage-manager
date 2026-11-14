import { beforeEach, describe, expect, it } from 'vitest'
import {
    STORAGE_KEYS, credentialId, loadCredentials, loadDirectory, loadSelectedIndex, parseStoredCredentials,
    saveCredentials, saveDirectory, validateCredential,
} from '../../src/helpers/credentials.js'

class MemoryStorage {
    constructor() { this.m = new Map() }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
    setItem(k, v) { this.m.set(k, String(v)) }
    removeItem(k) { this.m.delete(k) }
}

const good = { name: 'bucket', access_key: 'AK', secret_key: 'SK', region: 'us-east-1', endpoint: 'https://s3.amazonaws.com' }

beforeEach(() => {
    globalThis.localStorage = new MemoryStorage()
})

describe('parseStoredCredentials', () => {
    it('accepts the legacy single object and the array shape', () => {
        expect(parseStoredCredentials(JSON.stringify(good)).list).toEqual([good])
        expect(parseStoredCredentials(JSON.stringify([good, { ...good, name: 'b2', publicUrl: 'https://cdn.x' }])).list).toHaveLength(2)
    })
    it('ignores corrupt JSON and unusable entries without throwing', () => {
        expect(parseStoredCredentials('{not json')).toEqual({ list: [], invalidCount: 1 })
        const r = parseStoredCredentials(JSON.stringify([good, { name: 'x' }, null, 5, { ...good, endpoint: 'javascript:alert(1)' }]))
        expect(r.list).toEqual([good])
        expect(r.invalidCount).toBe(4)
    })
    it('keeps entries an older version saved with an unusual public URL (it is ignored when used)', () => {
        expect(parseStoredCredentials(JSON.stringify([{ ...good, publicUrl: 'cdn.example.com' }])).list).toHaveLength(1)
    })
})

describe('validateCredential (forms)', () => {
    it('requires the fields and http(s) URLs', () => {
        expect(validateCredential(good)).toEqual({})
        expect(validateCredential({ ...good, endpoint: 'ftp://x' })).toHaveProperty('endpoint')
        expect(validateCredential({ ...good, publicUrl: 'javascript:x' })).toHaveProperty('publicUrl')
        expect(validateCredential({ ...good, name: 'a/b' })).toHaveProperty('name')
        expect(validateCredential({ ...good, region: ' ' })).toHaveProperty('region')
    })
})

describe('saveCredentials', () => {
    it('never drops unusable entries the user did not remove', () => {
        localStorage.setItem(STORAGE_KEYS.credentials, JSON.stringify([good, { name: 'broken' }]))
        const { list } = loadCredentials()
        saveCredentials([...list, { ...good, name: 'second' }])
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.credentials))
        expect(raw.map(c => c.name)).toEqual(['bucket', 'second', 'broken'])
    })
})

describe('loadSelectedIndex', () => {
    it('clamps a stale or invalid index to 0', () => {
        localStorage.setItem(STORAGE_KEYS.selectedIndex, '5')
        expect(loadSelectedIndex(2)).toBe(0)
        localStorage.setItem(STORAGE_KEYS.selectedIndex, '1')
        expect(loadSelectedIndex(2)).toBe(1)
        localStorage.setItem(STORAGE_KEYS.selectedIndex, 'abc')
        expect(loadSelectedIndex(2)).toBe(0)
    })
})

describe('folder memory per bucket', () => {
    it('migrates the legacy currentDirectory once, then remembers per bucket', () => {
        localStorage.setItem(STORAGE_KEYS.currentDirectory, '/photos/2024')
        const a = good
        const b = { ...good, name: 'other' }
        expect(loadDirectory(a)).toBe('photos/2024/')
        saveDirectory(a, 'docs/')
        expect(loadDirectory(a)).toBe('docs/')
        expect(loadDirectory(b)).toBe('') // another bucket does not inherit a path that may not exist
        expect(localStorage.getItem(STORAGE_KEYS.currentDirectory)).toBe('/docs/') // legacy key still written
        expect(credentialId(a)).not.toBe(credentialId(b))
    })
})
