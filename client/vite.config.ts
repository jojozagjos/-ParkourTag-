import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Keep chunking defaults to let Vite manage dependency graph ordering.
export default defineConfig({
  plugins: [react()],
  server: { port: 3000 }
})

