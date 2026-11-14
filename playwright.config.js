import { defineConfig, devices } from '@playwright/test'

// Two ways the production build is served:
// - "default": `vite preview` of dist/ at '/', i.e. Vercel / Apache / any host at the domain root.
// - "pages":   build with VITE_BASE_PATH=/s3-storage-manager/ served by a GitHub-Pages-like static
//              server (sub-path, 404.html fallback, no custom headers: only the <meta> CSP applies).
const PAGES_BASE = '/s3-storage-manager/'

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [
    { name: 'default', use: { baseURL: 'http://localhost:4173/' } },
    { name: 'pages', use: { baseURL: `http://localhost:4174${PAGES_BASE}` } },
  ],
  webServer: [
    {
      command: 'npx vite build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npx vite build --outDir dist-pages --emptyOutDir && node scripts/pages-postbuild.mjs dist-pages && node scripts/static-server.mjs dist-pages ${PAGES_BASE} 4174`,
      env: { VITE_BASE_PATH: PAGES_BASE },
      url: `http://localhost:4174${PAGES_BASE}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
