export type Settings = {
  sensitivity: number
  invertY: boolean
  fov: number
  maxDpr: number
  masterVolume: number
}

const DEFAULTS: Settings = {
  sensitivity: 0.0025,
  invertY: false,
  fov: 80,
  maxDpr: 1.25,
  masterVolume: 0.8,
}

let current: Settings = load()
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    const raw = localStorage.getItem('settings')
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULTS }
}

export function getSettings(): Settings { return current }
export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  try { localStorage.setItem('settings', JSON.stringify(current)) } catch {}
  for (const fn of listeners) fn()
}
export function subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn) }

export function resetSettings() {
  current = { ...DEFAULTS }
  try { localStorage.setItem('settings', JSON.stringify(current)) } catch {}
  for (const fn of listeners) fn()
}

// UI global flags
let paused = false
export function setPaused(v: boolean) { paused = v }
export function isPaused() { return paused }
