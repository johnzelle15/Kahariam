import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/get_statistics': 'http://localhost:5000',
      '/get_inventory': 'http://localhost:5000',
      '/get_adjustments': 'http://localhost:5000',
      '/get_years': 'http://localhost:5000',
      '/get_count': 'http://localhost:5000',
      '/get_state': 'http://localhost:5000',
      '/start': 'http://localhost:5000',
      '/stop': 'http://localhost:5000',
      '/add_to_tank': 'http://localhost:5000',
      '/save_inventory': 'http://localhost:5000',
      '/adjust_stock': 'http://localhost:5000',
      '/api': 'http://localhost:5000'
    }
  }
})
