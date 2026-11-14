// URL safety helpers. Values come from localStorage (user typed), so treat them as untrusted.

/** Returns the URL string when it is an absolute http(s) URL, otherwise ''. */
export function safeHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return ''
    try {
        const u = new URL(value.trim())
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
        if (u.username || u.password) return ''
        return value.trim()
    } catch {
        return ''
    }
}

export function isHttpUrl(value) {
    return safeHttpUrl(value) !== ''
}

/** Open a URL in a new tab without giving the new page a handle to this window (no reverse tabnabbing). */
export function openInNewTab(url) {
    const safe = safeHttpUrl(url)
    if (!safe) return false
    const a = document.createElement('a')
    a.href = safe
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
    return true
}
