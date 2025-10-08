export const SFX_URLS = {
  jump: '/assets/sfx/jump.wav',
  slide: '/assets/sfx/slide.wav',
  wallrun: '/assets/sfx/wallrun.wav',
  walljump: '/assets/sfx/walljump.wav',
  mantle: '/assets/sfx/mantle.wav',
  land: '/assets/sfx/land.wav',
  tag: '/assets/sfx/tag.wav',
  countdown: '/assets/sfx/countdown.wav',
  round_start: '/assets/sfx/round_start.wav',
  round_end: '/assets/sfx/round_end.wav',
}

const cache = new Map<string, HTMLAudioElement>()

export function playSfx(name: keyof typeof SFX_URLS, volume = 0.6) {
  const url = SFX_URLS[name]
  if (!url) return
  let a = cache.get(url)
  if (!a) {
    a = new Audio(url)
    cache.set(url, a)
  }
  const inst = a.cloneNode(true) as HTMLAudioElement
  inst.volume = volume
  inst.play().catch(() => {})
}

export default {
  playSfx,
  SFX_URLS,
}
