let ctx: AudioContext | null = null
function ensureCtx() { if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)() }

function beep(freq: number, dur = 0.12, type: OscillatorType = 'sine', gain = 0.05) {
  ensureCtx(); if (!ctx) return
  const t0 = ctx.currentTime
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.value = gain
  osc.connect(g).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + dur)
}

export const SFX = {
  jump() { beep(420, 0.08, 'square', 0.06) },
  wallrun() { beep(320, 0.2, 'sawtooth', 0.04) },
  walljump() { beep(500, 0.12, 'square', 0.06) },
  slide() { beep(150, 0.18, 'triangle', 0.05) },
  mantle() { beep(280, 0.12, 'sine', 0.05) },
  land() { beep(220, 0.06, 'sine', 0.04) },
  tag() { beep(700, 0.1, 'square', 0.08) }
}

export function pulseScreen(el: HTMLElement, cssVar: string, max = 1, decayMs = 220) {
  el.style.setProperty(cssVar, String(max))
  const start = performance.now()
  function step() {
    const dt = performance.now() - start
    const k = Math.max(0, 1 - dt / decayMs)
    el.style.setProperty(cssVar, String(k * max))
    if (k > 0) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
