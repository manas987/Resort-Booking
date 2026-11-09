import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Backend guest API — proxied so cookies (resort_refresh) stay first-party and every
    // fetch() in the app can use a plain relative /api/... path. See Docs/14-frontend-api-map.md.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
