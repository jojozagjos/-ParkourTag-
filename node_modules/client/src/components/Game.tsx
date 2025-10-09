import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { Socket } from 'socket.io-client'
import { useFPControls } from '../controls/useFPControls'
import { MapMeshes } from '../map'
import type { Snapshot, NetPlayer, RoundResults, InputState } from '../types'
import Scoreboard from './Scoreboard'
import ResultsModal from './ResultsModal'
import MapVote from './MapVote'
import { SnapshotBuffer } from './interp'
import { pulseScreen } from '../sfx'
import { playSfx } from '../assets'
import Skybox from './Skybox'
import { TextureLoader } from 'three'
import faceTexturePath from '/assets/textures/face.png'
import constants from '../../../shared/constants.json'

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }

export default function Game({ socket, selfId }: { socket: Socket, selfId: string }) {
  const inputRef = useFPControls(socket)
  const [snapRaw, setSnapRaw] = useState<Snapshot | null>(null)
  const [results, setResults] = useState<RoundResults | null>(null)
  const [maps, setMaps] = useState<string[]>([])
  const [mapName, setMapName] = useState<string>('')

  const bufferRef = useRef(new SnapshotBuffer())
  const [snap, setSnap] = useState<Snapshot | null>(null)

  useEffect(() => {
    const onSnap = (s: Snapshot) => {
      bufferRef.current.push(s)
      setSnapRaw(s)
    }
    socket.on('world:snapshot', onSnap)
    socket.on('round:results', (r: RoundResults) => setResults(r))
    socket.on('lobby:update', (p:{maps:string[], mapName:string}) => {
      if (p?.maps) setMaps(p.maps)
      if (p?.mapName) setMapName(p.mapName)
    })
    socket.on('sfx', (e:{kind:string,id:string,target?:string}) => {
      const kind = String(e.kind || '').toLowerCase()
      const map: Record<string,string> = {
        jump: 'jump', slide: 'slide', wallrun: 'wallrun', walljump: 'walljump',
        mantle: 'mantle', land: 'land', tag: 'tag', countdown: 'countdown',
        round_start: 'round_start', round_end: 'round_end'
      }
      const key = map[kind] || 'jump'
      try { playSfx(key as any) } catch {/* ignore */}
      if (kind === 'jump') fxPulse('--jump', 0.7)
      if (kind === 'tag') fxPulse('--hit', 1.0)
    })
    return () => {
      socket.off('world:snapshot', onSnap)
      socket.off('round:results')
      socket.off('lobby:update')
      socket.off('sfx')
    }
  }, [socket])

  // Interpolation sampler
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const s = bufferRef.current.sample()
      if (s) setSnap(s)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const me = useMemo(() => snap?.players.find(p => p.id === selfId), [snap, selfId])

  return (
    <>
      <Canvas camera={{ position: [0, 2, 4], fov: 80 }} shadows>
        <Skybox />
        <hemisphereLight args={["#e6f7ff", "#44404a", 0.9]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 14, 6]} intensity={1.2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-bias={-0.0005} />
        <MapMeshes />
        {snap?.players.map(p => <Avatar key={p.id} p={p} isSelf={p.id === selfId} isIt={snap?.itId === p.id} />)}
        <FPCamera me={me || null} inputRef={inputRef} />
      </Canvas>

      <div className="hud" style={{ position:'fixed', top:12, left:12 }}>
        <div>Players: {snap?.players.length ?? 0}</div>
        <div>Status: {snap?.intermission ? 'Intermission' : (snap?.itId === selfId ? 'You are IT!' : (snap?.itId ? 'Run!' : ''))}</div>
        <div>Time: {Math.ceil(snap?.roundTime ?? 0)}s</div>
        <div>Map: {snap?.mapName || mapName}</div>
        <div style={{ marginTop: 8 }}>Click to lock mouse</div>
      </div>

      {snap && <Scoreboard scores={snap.scores} itId={snap.itId} />}
      <ResultsModal results={results} />
      {snap?.intermission && <MapVote socket={socket} maps={maps} current={snap.mapName} />}
    </>
  )
}

function fxPulse(varName:string, strength:number) {
  const fx = document.getElementById('fx')
  if (!fx) return
  pulseScreen(fx, varName, strength, 200)
}

function Avatar({ p, isSelf, isIt }: { p: NetPlayer, isSelf: boolean, isIt: boolean }) {
  const faceTexture = useMemo(() => new TextureLoader().load(faceTexturePath), [])
  return (
    <group position={p.pos as any} rotation={[0, p.yaw, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.7, 1.8, 0.7]} />
        <meshStandardMaterial {...({ color: isSelf ? '#6bd3ff' : (isIt ? '#ff5d5d' : '#f0b46d') } as any)} />
      </mesh>
      <mesh position={[0, 0.5, -0.36]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.7, 0.7]} />
        <meshBasicMaterial map={faceTexture} transparent />
      </mesh>
    </group>
  )
}

/**
 * First-person camera with rich movement feel:
 * - Client-side soft prediction (pos/vel/yaw/pitch) + reconciliation
 * - Speed-based FOV widening
 * - Head bob (grounded & moving)
 * - Strafe tilt (A/D)
 * - Wall-run roll (mode: wallrunL/wallrunR)
 * - Slide pitch dip (mode: slide)
 * - Landing kick when transitioning air -> ground
 * - Gentle camera smoothing
 *
 * Visual effects are view-only; authoritative movement still comes from server.
 */
function FPCamera({ me, inputRef }: { me: NetPlayer | null, inputRef: React.RefObject<InputState> }) {
  const { camera } = useThree()

  // Persistent bases (no FX applied here)
  const baseYawRef   = useRef(0)
  const basePitchRef = useRef(0)

  // FX state
  const fovRef     = useRef(80)
  const baseRoll   = useRef(0)     // strafe/wallrun roll
  const swayRoll   = useRef(0)     // L/R swing → roll
  const swayYaw    = useRef(0)     // L/R swing → tiny yaw
  const swayPitch  = useRef(0)     // subtle vertical beat
  const pitchFx    = useRef(0)     // slide/landing pitch bias
  const phase      = useRef(0)     // swing phase
  const prevMode   = useRef<string | null>(null)
  const prevY      = useRef<number | null>(null)

  // Tunables (smaller and calmer)
  const EYE_HEIGHT      = 1.62
  const BASE_FOV        = 80
  const MAX_FOV         = 96
  const SPEED_FOV_GAIN  = 0.14

  const SWAY_FREQ_BASE  = 1.4       // Hz at reference speed
  const SWAY_ROLL_AMP   = 0.045     // ~2.6°
  const SWAY_YAW_AMP    = 0.012     // ~0.7°
  const SWAY_PITCH_AMP  = 0.006     // ~0.34° (set 0 to remove)
  const SWAY_SPEED_REF  = 7.5
  const SWAY_RESP       = 12.0      // smoothing toward target

  const STRAFE_TILT     = 0.04      // smaller strafe tilt
  const WALL_ROLL       = 0.18
  const SLIDE_PITCH     = -0.08
  const LAND_KICK       = -0.05
  const LAND_RECOVER    = 12.0

  useEffect(() => {
    if (!me) return
    // initialize bases from current camera/me to avoid a jump on first frame
    baseYawRef.current   = inputRef.current?.yaw ?? me.yaw
    basePitchRef.current = inputRef.current?.pitch ?? me.pitch
    prevMode.current = me.mode
    prevY.current = me.pos[1]
  }, [me])

  useFrame((_, dt) => {
    if (!me) return

    // ---------- Authoritative position (no positional bob) ----------
    const eye = [me.pos[0], me.pos[1] + EYE_HEIGHT, me.pos[2]]
    camera.position.x += (eye[0] - camera.position.x) * Math.min(1, dt * 10)
    camera.position.y += (eye[1] - camera.position.y) * Math.min(1, dt * 12)
    camera.position.z += (eye[2] - camera.position.z) * Math.min(1, dt * 10)

    // ---------- Base yaw/pitch (separate from effects to avoid feedback) ----------
    const targetYaw   = inputRef.current?.yaw ?? me.yaw
    const targetPitch = inputRef.current?.pitch ?? me.pitch
    const oriK = Math.min(1, dt * 12)
    baseYawRef.current   += (targetYaw   - baseYawRef.current)   * oriK
    basePitchRef.current += (targetPitch - basePitchRef.current) * oriK

    // ---------- Speed-based FOV (gentler) ----------
    const speed = Math.hypot(me.vel[0], me.vel[2])
    const targetFov = Math.max(BASE_FOV, Math.min(MAX_FOV, BASE_FOV + speed * SPEED_FOV_GAIN))
    fovRef.current += (targetFov - fovRef.current) * Math.min(1, dt * 2.5)

    // ---------- Swing driver (grounded/moving → enable amplitude) ----------
    const yNow = me.pos[1]
    const dy   = prevY.current == null ? 0 : Math.abs(yNow - prevY.current)
    prevY.current = yNow
    const grounded  = !!me.onGround || me.mode === 'ground' || me.mode === 'slide' || dy < 0.008
    const moving    = speed > 0.4

    const ampScale  = grounded && moving ? Math.max(0.6, Math.min(1.4, speed / SWAY_SPEED_REF)) : 0
    const freq      = SWAY_FREQ_BASE * Math.max(0.9, Math.min(1.3, speed / SWAY_SPEED_REF))
    phase.current  += dt * freq * Math.PI * 2

    // Clean periodic signals
    const sin1 = Math.sin(phase.current)
    const sin2 = Math.sin(phase.current * 2.0)

    // IMPORTANT: flip left↔right by negating swing signs here
    const targetSwayRoll  = - (SWAY_ROLL_AMP  * ampScale) * sin1
    const targetSwayYaw   = - (SWAY_YAW_AMP   * ampScale) * sin1
    const targetSwayPitch =    (SWAY_PITCH_AMP * ampScale) * sin2

    const sK = Math.min(1, dt * SWAY_RESP)
    swayRoll.current  += (targetSwayRoll  - swayRoll.current)  * sK
    swayYaw.current   += (targetSwayYaw   - swayYaw.current)   * sK
    swayPitch.current += (targetSwayPitch - swayPitch.current) * sK

    // ---------- Strafe tilt + wall-run roll (baseline roll) ----------
    const inpt = inputRef.current
    const strafe = (inpt?.left ? -1 : 0) + (inpt?.right ? 1 : 0)
    // Right strafe tilts camera right; positive roll rotates left in ThreeJS → invert sign
    const strafeRoll = -STRAFE_TILT * strafe

    let modeRoll = 0
    if (me.mode === 'wallrunL') modeRoll = WALL_ROLL
    if (me.mode === 'wallrunR') modeRoll = -WALL_ROLL

    const targetBaseRoll = strafeRoll + modeRoll
    baseRoll.current += (targetBaseRoll - baseRoll.current) * Math.min(1, dt * 8)

    // ---------- Slide pitch + landing kick ----------
    let pitchBias = 0
    if (me.mode === 'slide') pitchBias += SLIDE_PITCH

    const was = prevMode.current
    if ((was === 'air' || was === 'wallrunL' || was === 'wallrunR' || was === 'mantle') && me.mode === 'ground') {
      pitchFx.current = LAND_KICK
    }
    prevMode.current = me.mode

    if (pitchFx.current !== 0) {
      const rec = Math.sign(-pitchFx.current) * Math.min(Math.abs(pitchFx.current), LAND_RECOVER * dt)
      pitchFx.current += rec
      if (Math.abs(pitchFx.current) < 1e-3) pitchFx.current = 0
    }

    // ---------- Compose final orientation ----------
    camera.rotation.order = 'YXZ'
    camera.rotation.y = baseYawRef.current + swayYaw.current
    camera.rotation.x = basePitchRef.current + (pitchBias + pitchFx.current) + swayPitch.current
    camera.rotation.z = baseRoll.current + swayRoll.current

    ;(camera as any).fov = fovRef.current
    camera.updateProjectionMatrix()
  })

  return null
}