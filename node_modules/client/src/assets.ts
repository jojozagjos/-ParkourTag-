// Use import.meta.url so Vite copies these into dist and returns hashed URLs.
// This file lives in src/, so assets are one directory up: ../assets/...
export const SFX_URLS = {
  jump: new URL('../assets/sfx/jump.wav', import.meta.url).toString(),
  slide: new URL('../assets/sfx/slide.wav', import.meta.url).toString(),
  wallrun: new URL('../assets/sfx/wallrun.wav', import.meta.url).toString(),
  mantle: new URL('../assets/sfx/mantle.wav', import.meta.url).toString(),
  land: new URL('../assets/sfx/land.wav', import.meta.url).toString(),
  tag: new URL('../assets/sfx/tag.wav', import.meta.url).toString(),
  countdown: new URL('../assets/sfx/countdown.wav', import.meta.url).toString(),
  round_start: new URL('../assets/sfx/round_start.wav', import.meta.url).toString(),
  round_end: new URL('../assets/sfx/round_end.wav', import.meta.url).toString(),
}

const cache = new Map<string, HTMLAudioElement>()
import { getSettings } from './state/settings'

export function playSfx(name: keyof typeof SFX_URLS, volume = 0.6) {
  const url = SFX_URLS[name]
  if (!url) return
  let a = cache.get(url)
  if (!a) {
    a = new Audio(url)
    cache.set(url, a)
  }
  const inst = a.cloneNode(true) as HTMLAudioElement
  const master = Math.max(0, Math.min(1, getSettings().masterVolume ?? 1))
  inst.volume = Math.max(0, Math.min(1, volume * master))
  inst.play().catch(() => {})
}

// No default export; use named exports
