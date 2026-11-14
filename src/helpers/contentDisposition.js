// RFC 6266 / RFC 5987 Content-Disposition value for a download filename.
// ASCII fallback in filename="..." plus the exact UTF-8 name in filename*=UTF-8''...

function encodeRfc5987(value) {
    return encodeURIComponent(value).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function asciiFallbackName(name) {
    const ascii = String(name)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7e]/g, '_')
        .replace(/["\\]/g, '_')
        .trim()
    return ascii || 'download'
}

export function contentDisposition(filename, type = 'attachment') {
    const name = String(filename || 'download').replace(/[\r\n]/g, ' ')
    return `${type}; filename="${asciiFallbackName(name)}"; filename*=UTF-8''${encodeRfc5987(name)}`
}
