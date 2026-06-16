import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/fishcast/v2/',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'FishCast',
        short_name: 'FishCast',
        description: 'Smart fishing planner for Denmark',
        start_url: '/fishcast/v2/',
        scope: '/fishcast/v2/',
        display: 'standalone',
        background_color: '#07111f',
        theme_color: '#38bdf8',
        orientation: 'portrait-primary',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Precache the built app shell; SPA fallback for navigations.
        globPatterns: ['**/*.{js,css,html,svg}'],
        navigateFallback: '/fishcast/v2/index.html',
        runtimeCaching: [
          {
            // OpenStreetMap map tiles — cache-first, capped
            urlPattern: /^https:\/\/[a-c]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Weather / tide / lightning APIs — network-first, short fallback cache
            urlPattern: /^https:\/\/(api\.open-meteo\.com|marine-api\.open-meteo\.com|geocoding-api\.open-meteo\.com|dmigw\.govcloud\.dk)\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'fishcast-api',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 6 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
