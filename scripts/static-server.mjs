#!/usr/bin/env node
// Minimal static server that behaves like GitHub Pages for e2e tests: serves a folder under a
// sub-path, sends NO custom headers (so only the <meta> CSP applies) and answers unknown paths with
// 404.html and status 404, exactly like Pages does for project sites.
//   node scripts/static-server.mjs <dir> <basePath> <port>
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const [dirArg = 'dist-pages', baseArg = '/s3-storage-manager/', portArg = '4174'] = process.argv.slice(2)
const root = resolve(dirArg)
const base = baseArg.endsWith('/') ? baseArg : `${baseArg}/`
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain',
}

async function send(res, file, status = 200) {
    const body = await readFile(file)
    res.writeHead(status, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
    res.end(body)
}

createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://x')
        // Like Pages: the folder without a trailing slash redirects to the folder.
        if (url.pathname === base.slice(0, -1)) {
            res.writeHead(301, { Location: base + url.search })
            return res.end()
        }
        if (!url.pathname.startsWith(base)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            return res.end('not found')
        }
        let rel = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html'
        if (rel.endsWith('/')) rel += 'index.html'
        const file = normalize(join(root, rel))
        if (!file.startsWith(root)) {
            res.writeHead(403)
            return res.end()
        }
        try {
            const s = await stat(file)
            if (s.isFile()) return await send(res, file)
        } catch { /* fall through to 404.html */ }
        return await send(res, join(root, '404.html'), 404)
    } catch (err) {
        console.error(err)
        res.writeHead(500)
        res.end('Internal server error')
    }
}).listen(Number(portArg), '127.0.0.1', () => {
    console.log(`static server: http://localhost:${portArg}${base} -> ${root}`)
})
