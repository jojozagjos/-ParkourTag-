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
  occluded?: boolean
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

  // Simple occlusion: low-pass + volume drop
  if (opts.occluded) {
    const biquad = ctx.createBiquadFilter()
    biquad.type = 'lowpass'
    biquad.frequency.value = 900 // muffle brightness
    biquad.Q.value = 0.7
    // @ts-ignore private API in three typings
    if (src.setFilter) src.setFilter(biquad)
    else {
      try { (src as any).filters = [biquad] } catch {}
    }
    src.setVolume(vol * 0.55)
  }

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
