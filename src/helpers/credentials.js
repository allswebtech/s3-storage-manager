// Saved credentials live in localStorage (this is a client-only app). These helpers keep the stored
// shape backward compatible: key 'credentials' holds one object or an array of
// { name (bucket), access_key, secret_key, region, endpoint, publicUrl? }.
import { safeHttpUrl } from './url'
import { toPrefix, toUiPath } from './keys'

export const STORAGE_KEYS = {
    credentials: 'credentials',
    selectedIndex: 'selectedCredentialIndex',
    currentDirectory: 'currentDirectory',
    directoryByBucket: 'currentDirectoryByBucket',
}

const REQUIRED = ['name', 'access_key', 'secret_key', 'region', 'endpoint']

function storage() {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage
    } catch {
        return null
    }
}

function read(key) {
    try { return storage()?.getItem(key) ?? null } catch { return null }
}

function write(key, value) {
    try { storage()?.setItem(key, value) } catch { /* storage full or blocked: keep working in memory */ }
}

function remove(key) {
    try { storage()?.removeItem(key) } catch { /* ignore */ }
}

/**
 * Validate one credential object. Returns an object of field -> message (empty when valid).
 * `strict` (used by the forms) also checks the optional public URL and the bucket name characters;
 * stored credentials are read leniently so nothing an older version saved is hidden.
 */
export function validateCredential(c, { strict = true } = {}) {
    const errors = {}
    if (!c || typeof c !== 'object') return { form: 'Invalid credential' }
    for (const f of REQUIRED) {
        if (typeof c[f] !== 'string' || !c[f].trim()) errors[f] = 'Required'
    }
    if (!errors.endpoint && !safeHttpUrl(c.endpoint)) errors.endpoint = 'Must be an http:// or https:// URL'
    if (!strict) return errors
    if (c.publicUrl != null && c.publicUrl !== '') {
        if (typeof c.publicUrl !== 'string' || !safeHttpUrl(c.publicUrl)) errors.publicUrl = 'Must be an http:// or https:// URL'
    }
    if (!errors.name && /[/\s]/.test(c.name.trim())) errors.name = 'Bucket name cannot contain "/" or spaces'
    return errors
}

export function isValidCredential(c, opts) {
    return Object.keys(validateCredential(c, opts)).length === 0
}

/** Trim the fields we store; keeps unknown extra fields untouched (forward/backward compatibility). */
export function normalizeCredential(c) {
    const out = { ...c }
    for (const f of [...REQUIRED, 'publicUrl']) {
        if (typeof out[f] === 'string') out[f] = out[f].trim()
    }
    if (!out.publicUrl) delete out.publicUrl
    return out
}

/** Stable identity of a saved bucket (used to remember the last folder per bucket). */
export function credentialId(c) {
    return c ? `${c.endpoint || ''}|${c.name || ''}` : ''
}

/**
 * Parse the raw localStorage value. Returns { list, invalidCount }. Invalid entries are left out of
 * `list` but never deleted from storage by this function.
 */
export function parseStoredCredentials(raw) {
    if (!raw) return { list: [], invalidCount: 0 }
    let parsed
    try {
        parsed = JSON.parse(raw)
    } catch {
        return { list: [], invalidCount: 1 }
    }
    const arr = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : [])
    const list = arr.filter(c => isValidCredential(c, { strict: false }))
    return { list, invalidCount: arr.length - list.length }
}

export function loadCredentials() {
    return parseStoredCredentials(read(STORAGE_KEYS.credentials))
}

function storedInvalidEntries() {
    try {
        const parsed = JSON.parse(read(STORAGE_KEYS.credentials) || 'null')
        const arr = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : [])
        return arr.filter(c => !isValidCredential(c, { strict: false }))
    } catch {
        return []
    }
}

/**
 * Persist the usable credentials. Entries an older version stored that cannot be used (missing fields)
 * are kept after them untouched, so saving never silently deletes data the user did not remove.
 */
export function saveCredentials(list) {
    const all = [...list, ...storedInvalidEntries()]
    if (!all.length) remove(STORAGE_KEYS.credentials)
    else write(STORAGE_KEYS.credentials, JSON.stringify(all))
}

export function loadSelectedIndex(listLength) {
    const n = Number.parseInt(read(STORAGE_KEYS.selectedIndex) ?? '', 10)
    return Number.isInteger(n) && n >= 0 && n < listLength ? n : 0
}

export function saveSelectedIndex(index) {
    write(STORAGE_KEYS.selectedIndex, String(index))
}

function readDirectoryMap() {
    try {
        const v = JSON.parse(read(STORAGE_KEYS.directoryByBucket) || '{}')
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    } catch {
        return {}
    }
}

/**
 * Last folder (as S3 prefix) opened for this credential. Falls back to the legacy single
 * 'currentDirectory' key only when nothing per-bucket was stored yet and the legacy value belongs to it.
 */
export function loadDirectory(cred) {
    const id = credentialId(cred)
    const map = readDirectoryMap()
    if (typeof map[id] === 'string') return toPrefix(map[id])
    if (!Object.keys(map).length) return toPrefix(read(STORAGE_KEYS.currentDirectory) || '/')
    return ''
}

export function saveDirectory(cred, prefix) {
    const id = credentialId(cred)
    if (!id) return
    const map = readDirectoryMap()
    map[id] = toUiPath(prefix)
    write(STORAGE_KEYS.directoryByBucket, JSON.stringify(map))
    // Keep the legacy key meaningful ("last folder") for older versions.
    write(STORAGE_KEYS.currentDirectory, toUiPath(prefix))
}

export function forgetDirectory(cred) {
    const map = readDirectoryMap()
    delete map[credentialId(cred)]
    write(STORAGE_KEYS.directoryByBucket, JSON.stringify(map))
}

export function clearAllStoredState() {
    for (const k of Object.values(STORAGE_KEYS)) remove(k)
}
