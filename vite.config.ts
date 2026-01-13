import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy MinerU API requests to bypass CORS
      '/api/mineru': {
        target: 'https://mineru.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/mineru/, '/api/v4'),
        secure: true
      }
    }
  }
})
