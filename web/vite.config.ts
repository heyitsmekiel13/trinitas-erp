import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Honour an assigned port when something else already holds 5173.
    port: Number(process.env.PORT) || 5173,
    open: true,
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // Keep the initial shell tiny; heavy libs load only when a page needs them.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          const path = id.replace(/\\/g, '/')
          if (path.includes('recharts') || path.includes('/d3-') || path.includes('victory-vendor')) return 'charts'
          if (path.includes('@tanstack/react-table')) return 'table'
          if (path.includes('react-router')) return 'router'
          // react-dom depends on scheduler, so they must share a chunk or the
          // graph becomes circular.
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(path)) return 'react'
          return 'vendor'
        },
      },
    },
  },
})
