import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('three')) return 'vendor_three'
            if (id.includes('react')) return 'vendor_react'
            if (id.includes('socket.io-client')) return 'vendor_socket'
            return 'vendor'
          }
        }
      }
    }
  }
})

