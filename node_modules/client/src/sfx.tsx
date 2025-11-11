// Minimal visual-only FX helper (audio handled via assets-based playback)

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
