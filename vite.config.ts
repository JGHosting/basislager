import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// base './' = relative Pfade, funktioniert unter jghosting.github.io/basislager/
export default defineConfig({
  base: './',
  // Versionsanzeige in "Mehr": Datum des Builds
  define: { __APP_VERSION__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Basislager',
        short_name: 'Basislager',
        description: 'Persönliches Training, Erholung und Ernährung',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#14171c',
        theme_color: '#14171c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // API-Aufrufe nie aus dem Cache beantworten
        navigateFallbackDenylist: [/^\/api/],
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,json}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,   // BLS-Datei (~600 KB) offline verfügbar
        runtimeCaching: [{
          // Kartenkacheln (OpenStreetMap/CARTO) zwischenspeichern – einmal gesehene Routen bleiben offline
          urlPattern: /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/.*/i,
          handler: 'CacheFirst',
          options: { cacheName: 'map-tiles', expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 60 }, cacheableResponse: { statuses: [0, 200] } }
        }]
      }
    })
  ]
});
