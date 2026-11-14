// Display formatting shared by the file list, upload queue and info modal.

/** Human readable size: 1536 -> '1.5 KB'. Returns '-' for missing values. */
export function formatBytes(bytes, { decimals = 1 } = {}) {
    if (bytes == null || typeof bytes !== 'number' || Number.isNaN(bytes)) return '-'
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    let i = 0
    let v = Math.abs(bytes)
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024
        i++
    }
    const factor = 10 ** (i === 0 ? 0 : decimals)
    return `${bytes < 0 ? '-' : ''}${Math.round(v * factor) / factor} ${units[i]}`
}

/** Locale date/time or '-' when missing/invalid. */
export function formatDate(value) {
    if (!value) return '-'
    const d = value instanceof Date ? value : new Date(value)
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString()
}
