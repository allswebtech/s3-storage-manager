// Single source of truth for the Content-Security-Policy and the other security headers.
// Used by vite.config.js (build-time <meta> CSP) and by scripts/sync-headers.mjs, which writes
// vercel.json and public/.htaccess. test/unit/security-headers.test.js fails if they drift apart.
//
// Why each source is allowed:
// - connect-src https: http:  the app talks to whatever S3-compatible endpoint the user configures
//   (AWS, R2, MinIO on a LAN over http, ...), so the origin cannot be pinned at build time.
// - img/media/frame-src https: http: blob: data:  previews load presigned or public object URLs.
// - style-src 'unsafe-inline'  react-toastify injects its stylesheet at runtime; no inline scripts are allowed.
// - fonts.googleapis.com / fonts.gstatic.com  Inter + JetBrains Mono loaded by index.html.

export const CSP_DIRECTIVES = [
    ["default-src", "'self'"],
    ["script-src", "'self'"],
    ["style-src", "'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    ["font-src", "'self'", "https://fonts.gstatic.com"],
    ["img-src", "'self'", "data:", "blob:", "https:", "http:"],
    ["media-src", "'self'", "blob:", "https:", "http:"],
    ["frame-src", "'self'", "blob:", "https:", "http:"],
    ["connect-src", "'self'", "https:", "http:"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["manifest-src", "'self'"],
]

// Directives a <meta http-equiv> CSP ignores; they are only sent as real headers.
export const HEADER_ONLY_DIRECTIVES = [
    ["frame-ancestors", "'none'"],
]

const join = (list) => list.map(d => d.join(' ')).join('; ')

/** CSP for the <meta http-equiv="Content-Security-Policy"> tag (GitHub Pages and any static host). */
export const CSP_META = join(CSP_DIRECTIVES)

/** CSP sent as an HTTP header (Vercel, Apache/LiteSpeed). */
export const CSP_HEADER = join([...CSP_DIRECTIVES, ...HEADER_ONLY_DIRECTIVES])

export const SECURITY_HEADERS = {
    'Content-Security-Policy': CSP_HEADER,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
}

export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const HTML_CACHE_CONTROL = 'no-cache'
