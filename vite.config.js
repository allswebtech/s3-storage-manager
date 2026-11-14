import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { CSP_META } from './config/security-headers.js'

// Base path the app is served from: '/' (default) or a sub-path such as '/s3-storage-manager/'
// for GitHub Pages project sites. Set VITE_BASE_PATH at build time.
export function normalizeBase(value) {
  // Accepts '', '/', '//', 'x', '/x', '/x/', '/x//' (e.g. `${base_path}/` from actions/configure-pages).
  const trimmed = String(value || '').trim().replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}/` : '/'
}

// Adds the Content-Security-Policy <meta> tag to the production index.html only, so the Vite dev
// server (which injects inline scripts for HMR) keeps working.
function cspMetaPlugin() {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Right after <meta charset>, before any stylesheet or script it has to govern.
        const tag = `<meta http-equiv="Content-Security-Policy" content="${CSP_META.replace(/"/g, '&quot;')}" />`
        const marker = /<meta charset="UTF-8" \/>/i
        if (!marker.test(html)) throw new Error('csp-meta: <meta charset="UTF-8" /> not found in index.html')
        return html.replace(marker, (m) => `${m}\n    ${tag}`)
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: normalizeBase(process.env.VITE_BASE_PATH ?? env.VITE_BASE_PATH),
    plugins: [
      react(),
      tailwindcss(),
      cspMetaPlugin(),
    ],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'aws-sdk', test: /node_modules[\\/](@aws-sdk|@smithy|@aws-crypto|fast-xml-parser|strnum|tslib|bowser|uuid)[\\/]/ },
              { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|cookie|set-cookie-parser)[\\/]/ },
            ],
          },
        },
      },
    },
  }
})
