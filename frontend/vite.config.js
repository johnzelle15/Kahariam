import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Catch-all: proxy every non-Vite request to Flask
      '^/(?!@vite|@react-refresh|@fs|__vite|node_modules|src)': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      }
    }
  }
})
