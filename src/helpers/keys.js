// Pure helpers for S3 keys and prefixes. No SDK imports here so they stay unit-testable.
//
// Terminology used across the app:
// - "prefix": an S3 key prefix for a folder. '' is the bucket root, otherwise it never starts with '/'
//   and always ends with exactly one '/', e.g. 'photos/2024/'.
// - "UI path": what older versions kept in localStorage ('/', '/photos', '/photos/'). Always converted with
//   toPrefix() before use.

/** Convert any folder path ('/', '/a/b', 'a/b/', '//a//') to a canonical S3 prefix ('' or 'a/b/'). */
export function toPrefix(path) {
    const raw = String(path ?? '').trim()
    const trimmed = raw.replace(/^\/+/, '').replace(/\/+$/, '')
    return trimmed ? `${trimmed}/` : ''
}

/** Canonical UI path for a prefix: '/' for the root, otherwise '/a/b/' (same shape older versions stored). */
export function toUiPath(prefix) {
    const p = toPrefix(prefix)
    return p ? `/${p}` : '/'
}

/** Remove a leading prefix from a key. Unlike String.replace this never interprets `$` patterns. */
export function stripPrefix(key, prefix) {
    const k = String(key ?? '')
    const p = String(prefix ?? '')
    if (!p) return k
    return k.startsWith(p) ? k.slice(p.length) : k
}

/** Last path segment of a key or prefix ('a/b/c.txt' -> 'c.txt', 'a/b/' -> 'b'). */
export function baseName(key) {
    const parts = String(key ?? '').split('/').filter(Boolean)
    return parts.length ? parts[parts.length - 1] : ''
}

/** Prefix of the folder that contains a key or prefix ('a/b/c.txt' -> 'a/b/', 'a/b/' -> 'a/', 'x' -> ''). */
export function parentPrefix(key) {
    const k = String(key ?? '').replace(/\/+$/, '')
    const idx = k.lastIndexOf('/')
    return idx >= 0 ? k.slice(0, idx + 1) : ''
}

/** Split a file name into [base, extension-with-dot]. Dot files ('.env') have no extension. */
export function splitExt(name) {
    const n = String(name ?? '')
    const dot = n.lastIndexOf('.')
    if (dot > 0 && dot < n.length - 1) return [n.slice(0, dot), n.slice(dot)]
    return [n, '']
}

/** 'dir/name.ext' + n -> 'dir/name (n).ext' (used for "keep both" / auto-rename). */
export function numberedKey(key, n) {
    const isFolder = String(key).endsWith('/')
    const parent = parentPrefix(key)
    const name = baseName(key)
    if (isFolder) return `${parent}${name} (${n})/`
    const [base, ext] = splitExt(name)
    return `${parent}${base} (${n})${ext}`
}

/**
 * Value for the CopySource parameter of CopyObject: 'bucket/key' with every path segment URL-encoded
 * so that '?', '#', '+', '&', '%', spaces and non-ASCII characters reach S3 unchanged.
 */
export function encodeCopySource(bucket, key) {
    const encodedKey = String(key).split('/').map(encodeURIComponent).join('/')
    return `${bucket}/${encodedKey}`
}

/** Encode a key for use in a URL path (keeps '/'). */
export function encodeKeyPath(key) {
    return String(key ?? '').split('/').map(encodeURIComponent).join('/')
}

const MAX_KEY_BYTES = 1024

/**
 * Validate a single file or folder name typed by the user (rename / new folder).
 * Returns an error message, or '' when the name is valid.
 */
export function validateName(name, { type = 'file', parent = '' } = {}) {
    const n = String(name ?? '')
    const label = type === 'folder' ? 'Folder name' : 'File name'
    if (!n.trim()) return `${label} cannot be empty`
    if (n !== n.trim()) return `${label} cannot start or end with spaces`
    if (n.includes('/')) return `${label} cannot contain "/"`
    if (n === '.' || n === '..') return `${label} cannot be "." or ".."`
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(n)) return `${label} cannot contain control characters`
    const fullKey = `${parent}${n}${type === 'folder' ? '/' : ''}`
    if (new TextEncoder().encode(fullKey).length > MAX_KEY_BYTES) return `${label} is too long (S3 keys are limited to 1024 bytes)`
    return ''
}

/**
 * Resolve where `item` goes for the destination the user typed.
 * - '' / ends with '/' / source is a folder / multi-segment path without extension -> treated as a folder:
 *   the item keeps its name inside it.
 * - otherwise it is the new key of the file (e.g. 'docs/new-name.txt').
 */
export function resolveDestination(item, typed) {
	const dst = String(typed || '').trim().replace(/^\/+/, '')
	const srcIsFolder = item.type === 'folder'
	const lastSeg = dst.split('/').filter(Boolean).pop() || ''
	const dstLooksDir = dst === '' || dst.endsWith('/') || srcIsFolder || (dst.includes('/') && !lastSeg.includes('.'))
	if (dstLooksDir) {
		const name = baseName(item.key)
		return toPrefix(dst) + (srcIsFolder ? `${name}/` : name)
	}
	return dst
}
