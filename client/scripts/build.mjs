import { build } from 'vite'

async function run() {
  try {
    await build() // uses vite.config.ts by default
    console.log('[client] Vite build completed')
  } catch (err) {
    console.error('[client] Vite build failed:', err)
    process.exit(1)
  }
}

run()
