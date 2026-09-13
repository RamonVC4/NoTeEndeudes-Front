import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // El SW se actualiza solo al publicar una versión nueva; el plugin
      // inyecta el registro en index.html, así que main.tsx no cambia.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'No te endeudes',
        short_name: 'No te endeudes',
        description: 'Antes de comprar, mira qué le pasa a tu dinero.',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#004977',
        background_color: '#eef1f4',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // El plugin ya precachea el manifest y sus iconos; aquí va el resto.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        globIgnores: ['icons/icon-*.png', 'icons/maskable-*.png'],
        // Rutas de React Router: cualquier navegación sin red cae en index.html.
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
