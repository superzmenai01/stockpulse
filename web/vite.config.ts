import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',  // 允許所有網絡接口訪問
    proxy: {
      '/api': {
        target: 'http://localhost:18792',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:18792',
        ws: true,
      },
    },
  },
})
