#!/usr/bin/env node
// GitHub Pages has no rewrites: serve the app for unknown paths via 404.html (a copy of index.html)
// and disable Jekyll processing. Run after `vite build` for Pages deployments only.
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Optional argument: the build folder (default dist/).
const dist = process.argv[2] ? process.argv[2] : join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (!existsSync(join(dist, 'index.html'))) {
    console.error('dist/index.html not found: run the build first')
    process.exit(1)
}
copyFileSync(join(dist, 'index.html'), join(dist, '404.html'))
writeFileSync(join(dist, '.nojekyll'), '')
console.log(`wrote ${join(dist, '404.html')} and ${join(dist, '.nojekyll')}`)
