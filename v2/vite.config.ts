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
          // API data must never pass for fresher than it is. One NetworkFirst
          // rule with an 8 s timeout used to cover every API: on a slow coastal
          // connection it answered with a copy up to 6 h old, which the app
          // stamped "updated just now" and then treated as fresh for another
          // 3 h. So: no timeouts (the cache answers only when the network
          // actually fails), and weather copies carry their real fetch time.
          {
            // Weather + marine forecasts. Each response stored is stamped with
            // when it was fetched; weather.ts (fetchedAt) reads that back from
            // a cached copy, so it shows its true age and is refetched once
            // the signal returns. The header name must match weather.ts.
            urlPattern: /^https:\/\/(api|marine-api)\.open-meteo\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'fishcast-weather',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 48 },
              cacheableResponse: { statuses: [200] },
              plugins: [{
                // Serialised into the service worker as source: it can't use
                // anything from this file.
                cacheWillUpdate: async ({ response }) => {
                  const headers = new Headers(response.headers)
                  headers.set('x-fc-fetched-at', String(Date.now()))
                  return new Response(await response.blob(), {
                    status: response.status, statusText: response.statusText, headers,
                  })
                },
              }],
            },
          },
          {
            // Place search and DMI's tide-station list don't go stale in hours,
            // so a cached copy is as good as a live one when offline.
            urlPattern: /^https:\/\/(geocoding-api\.open-meteo\.com\/|dmigw\.govcloud\.dk\/v2\/oceanObs\/collections\/tidewaterstation\/).*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'fishcast-reference',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // DMI lightning and tide-prediction requests are deliberately NOT
          // cached: their URLs carry the current time, so a cached copy could
          // never be served — every one was only written, and ~18 lightning
          // entries per refresh evicted the weather entries worth keeping.
          // A strike report from the cache would be wrong in any case.
        ],
      },
    }),
  ],
  server: { port: 5173 },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
