import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fierro.png', 'fierce-192.png', 'fierce-512.png'],
      manifest: {
        name: 'RanchoFinanzas',
        short_name: 'Finanzas',
        description: 'Control de ingresos y gastos para tu rancho',
        theme_color: '#1a1a2e',
        background_color: '#0f0f23',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'es',
        icons: [
          {
            src: 'fierro.png',
            sizes: 'any',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'fierce-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'fierce-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
