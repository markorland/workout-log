/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Shown in Settings -> About, so you can tell which build the phone is running.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }
function gitCommit(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    const dirty = execSync('git status --porcelain', { encoding: 'utf-8' }).trim() !== ''
    return dirty ? `${sha} + local changes` : sha
  } catch {
    return 'unknown'
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-64.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Workout Log',
        short_name: 'Workout Log',
        description: 'Replays the TrueCoach program and logs every set.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell works offline; data lives in IndexedDB, never in the SW cache.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/_\//],
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Launch screens are fetched by iOS itself; no need to cache all ten offline.
        globIgnores: ['splash/**'],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
})
