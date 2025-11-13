import * as THREE from 'three'
import { SFX_URLS } from '../assets'
import { getSettings } from '../state/settings'

let listener: THREE.AudioListener | null = null
let audioLoader: THREE.AudioLoader | null = null
const buffers = new Map<string, AudioBuffer>()

export function initPositionalAudio(camera: THREE.Camera) {
  if (!listener) {
    listener = new THREE.AudioListener()
    camera.add(listener)
  }
  if (!audioLoader) audioLoader = new THREE.AudioLoader()
}

async function getBuffer(key: keyof typeof SFX_URLS): Promise<AudioBuffer | null> {
  if (!audioLoader) return null
  const url = SFX_URLS[key]
  if (!url) return null
  if (buffers.has(url)) return buffers.get(url) || null
  return new Promise((resolve) => {
    audioLoader!.load(url, (buf) => { buffers.set(url, buf); resolve(buf) }, undefined, () => resolve(null))
  })
}

export type Play3DOpts = {
  position: [number, number, number]
  volume?: number
  // 0..1 occlusion strength; boolean true treated as 1
  occlusion?: number | boolean
  // Optional source/listener velocity and listener position for doppler
  sourceVel?: [number, number, number]
  listenerPos?: [number, number, number]
  listenerVel?: [number, number, number]
}

export async function playSfx3D(name: keyof typeof SFX_URLS, opts: Play3DOpts) {
  if (!listener) return
  const ctx = listener.context
  const master = Math.max(0, Math.min(1, getSettings().masterVolume ?? 1))
  const vol = Math.max(0, Math.min(1, (opts.volume ?? 0.7) * master))
  const buffer = await getBuffer(name)
  if (!buffer) return

  // Create positional audio
  const src = new THREE.PositionalAudio(listener)
  src.setBuffer(buffer)
  src.setRefDistance(6)
  src.setRolloffFactor(1.2)
  src.setDistanceModel('linear')
  src.setVolume(vol)

  // Simple occlusion: low-pass + volume drop scaled by occlusion strength
  let occ = 0
  if (typeof opts.occlusion === 'boolean') occ = opts.occlusion ? 1 : 0
  else if (typeof opts.occlusion === 'number') occ = Math.max(0, Math.min(1, opts.occlusion))
  if (occ > 0) {
    const biquad = ctx.createBiquadFilter()
    biquad.type = 'lowpass'
    // 0→ no occlusion ~6kHz, 1→ heavy occlusion ~900Hz
    const freq = 6000 * (1 - occ) + 900
    biquad.frequency.value = freq
    biquad.Q.value = 0.7
    // @ts-ignore private API in three typings
    if ((src as any).setFilter) (src as any).setFilter(biquad)
    else { try { (src as any).filters = [biquad] } catch {} }
    src.setVolume(vol * (1 - 0.45 * occ))
  }

  // Doppler approximation: adjust playbackRate by relative LOS velocity
  // If velocities provided, compute radial component along (src - listener)
  try {
    const lis = opts.listenerPos ?? (listener.parent ? [listener.parent.position.x, listener.parent.position.y, listener.parent.position.z] as [number,number,number] : undefined)
    const lvel = opts.listenerVel ?? [0,0,0]
    if (lis && opts.sourceVel) {
      const dx = opts.position[0] - lis[0]
      const dy = opts.position[1] - lis[1]
      const dz = opts.position[2] - lis[2]
      const L = Math.hypot(dx, dy, dz) || 1
      const nx = dx / L, ny = dy / L, nz = dz / L
      const rel = [(opts.sourceVel[0] - lvel[0]), (opts.sourceVel[1] - lvel[1]), (opts.sourceVel[2] - lvel[2])]
      const vlos = rel[0]*nx + rel[1]*ny + rel[2]*nz // toward listener positive
      // Map to small playback rate shift; clamp gentle range
      const rate = Math.max(0.85, Math.min(1.15, 1 + (vlos / 50) * 0.35))
      ;(src as any).setPlaybackRate?.(rate)
    }
  } catch {}

  // Temp object to host the audio in the scene graph
  const obj = new THREE.Object3D()
  obj.position.set(opts.position[0], opts.position[1], opts.position[2])
  listener.parent?.add(obj)
  obj.add(src)
  src.play()
  const cleanup = () => {
    try { obj.remove(src) } catch {}
    try { listener!.parent?.remove(obj) } catch {}
    try { (src as any).disconnect?.() } catch {}
  }
  try { if ((src as any).source && (src as any).source.onended !== undefined) { (src as any).source.onended = cleanup } } catch {}
  // Safety cleanup in case onended doesn't fire (older browsers)
  setTimeout(cleanup, (buffer.duration + 0.25) * 1000)
}
