import React, { Suspense, memo, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
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
import { rememberMany } from '../nameRegistry'
// Import the face texture so Vite copies it into dist; absolute /assets paths were not bundled.
import faceTexturePath from '../../assets/textures/face.png'
import constants from '../../../shared/constants.json'
import { getSettings, setSettings, setPaused as setPausedGlobal, isPaused, subscribe, resetSettings } from '../state/settings'

export default function Game({ socket, selfId }: { socket: Socket; selfId: string }) {
  const inputRef = useFPControls(socket)
  const [results, setResults] = useState<RoundResults | null>(null)
  const [maps, setMaps] = useState<string[]>([])
  const [mapName, setMapName] = useState<string>('')
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({})
  const [myVote, setMyVote] = useState<string | null>(null)

  const bufferRef = useRef(new SnapshotBuffer())
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [paused, setPaused] = useState(false)

  // Socket listeners with stable refs for proper cleanup
  useEffect(() => {
    const onSnap = (s: Snapshot) => {
      // Update name registry to ensure HUDs can always resolve names
      try { rememberMany(s.players.map(p => ({ id: p.id, name: p.name }))) } catch {}
      bufferRef.current.push(s)
    }

    const onResults = (r: RoundResults) => setResults(r)

    // New round started: clear any previous results modal
    const onGameStarted = () => setResults(null)

    const onLobbyUpdate = (p: { maps?: string[]; mapName?: string; players?: Array<{ id: string; name: string }> }) => {
      if (p?.maps) setMaps(p.maps)
      if (p?.mapName) setMapName(p.mapName)
      if (Array.isArray(p?.players)) {
        try { rememberMany(p.players) } catch {}
      }
    }

  const onSfx = (e: { kind?: string; id?: string; target?: string }) => {
      const kind = String(e?.kind ?? '').toLowerCase()
      const map: Record<string, string> = {
        jump: 'jump',
        slide: 'slide',
        wallrun: 'wallrun',
        mantle: 'mantle',
        land: 'land',
        tag: 'tag',
        countdown: 'countdown',
        round_start: 'round_start',
        round_end: 'round_end'
      }
      const key = map[kind] || 'jump'
      try {
        playSfx(key as any)
      } catch {
        /* ignore */
      }
      if (kind === 'jump') fxPulse('--jump', 0.7)
      if (kind === 'tag') fxPulse('--hit', 1.0)
    }

    const onVoteUpdate = (payload: { votes: Record<string, string> }) => {
      const tally: Record<string, number> = {}
      for (const v of Object.values(payload.votes)) {
        if (!v) continue
        tally[v] = (tally[v] || 0) + 1
      }
      setVoteCounts(tally)
      if (socket && socket.id) {
        const mine = payload.votes[socket.id]
        if (typeof mine === 'string') setMyVote(mine)
      }
    }

    socket.on('world:snapshot', onSnap)
    socket.on('round:results', onResults)
    socket.on('game:started', onGameStarted)
    socket.on('lobby:update', onLobbyUpdate)
    socket.on('sfx', onSfx)
    socket.on('vote:update', onVoteUpdate)

    return () => {
      socket.off('world:snapshot', onSnap)
      socket.off('round:results', onResults)
      socket.off('game:started', onGameStarted)
      socket.off('lobby:update', onLobbyUpdate)
      socket.off('sfx', onSfx)
      socket.off('vote:update', onVoteUpdate)
    }
  }, [socket])

  // Pause toggle via Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        const next = !isPaused()
        setPausedGlobal(next)
        setPaused(next)
        if (next && document.pointerLockElement) {
          try { document.exitPointerLock() } catch {}
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Interpolation sampler
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const s = bufferRef.current.sample()
      if (s) {
        // During any intermission, trust snapshot to carry map options
        if (Array.isArray((s as any).maps) && (s as any).maps!.length) setMaps((s as any).maps!)
        setSnap(s)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Note: Do not clear results based on snapshots; snapshots can arrive slightly out of order
  // relative to events due to client-side buffering. We only clear on 'game:started'.

  const me = useMemo(() => snap?.players.find(p => p.id === selfId) ?? null, [snap, selfId])

  return (
    <>
      {/* Limit device pixel ratio to reduce GPU load on low-end machines */}
      <Canvas
        camera={{ position: [0, 2, 4], fov: 80 }}
        shadows
        dpr={Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, getSettings().maxDpr || 1.25)}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          // Use ACES tone mapping but increase exposure a bit for visibility; ensure sRGB output.
          gl.outputColorSpace = THREE.SRGBColorSpace
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.25
          gl.shadowMap.enabled = true
          gl.shadowMap.type = THREE.PCFSoftShadowMap
        }}
      >
        <Suspense fallback={null}>
          {/* Default skybox (no map-specific palettes) */}
          <Skybox />
          {/* Lighting pass: stronger fill + key */}
          <hemisphereLight args={['#e3f2ff', '#242a35', 1.4]} />
          <ambientLight intensity={0.7} />
          {/* Lower shadow-mapSize to reduce GPU shadow cost */}
          <directionalLight
            position={[14, 22, 12]}
            intensity={2.0}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.00035}
            shadow-normalBias={0.02}
            shadow-camera-near={1}
            shadow-camera-far={80}
            shadow-camera-left={-35}
            shadow-camera-right={35}
            shadow-camera-top={35}
            shadow-camera-bottom={-35}
          />
          {/* Secondary rim light to lift silhouettes */}
          <directionalLight position={[-10, 12, -8]} intensity={0.6} color={'#b8d4ff'} />
          <PreloadAssets />
          <MapMeshes name={snap?.mapName || mapName} />
          {snap?.players.map(p => (
            <Avatar key={p.id} p={p} isSelf={p.id === selfId} isIt={snap?.itId === p.id} />
          ))}
          <FPCamera me={me} inputRef={inputRef} />
        </Suspense>
      </Canvas>

      <div className="hud" style={{ position: 'fixed', top: 12, left: 12 }}>
        <div>Players: {snap?.players.length ?? 0}</div>
        <div>
          Status:{' '}
          {snap?.intermission ? 'Intermission' : snap?.itId === selfId ? 'You are IT!' : snap?.itId ? 'Run!' : ''}
        </div>
        <div>Time: {Math.ceil(snap?.roundTime ?? 0)}s</div>
        <div>Map: {snap?.mapName || mapName}</div>
        <div style={{ marginTop: 8 }}>Click to lock mouse</div>
      </div>

  {snap && <Scoreboard scores={snap.scores} itId={snap.itId} players={snap.players} />}
      <ResultsModal results={results} />
  {/* Map vote shown only during intermission; now used for pre-game vote as well */}
      {snap?.intermission && maps.length > 0 && (
        <MapVote socket={socket} maps={maps} current={snap.mapName} voteCounts={voteCounts} />
      )}
      {paused && <PauseMenu socket={socket} onClose={() => { setPausedGlobal(false); setPaused(false) }} />}
    </>
  )
}

function fxPulse(varName: string, strength: number) {
  const fx = document.getElementById('fx')
  if (!fx) return
  pulseScreen(fx, varName, strength, 200)
}

/**
 * Avatar:
 * - Uses useLoader to cache the face texture across instances.
 * - Reuses geometry and materials via memo to avoid per-frame allocations.
 */
const Avatar = memo(function Avatar({ p, isSelf, isIt }: { p: NetPlayer; isSelf: boolean; isIt: boolean }) {
  const baseFaceTexture = useLoader(TextureLoader, faceTexturePath)

  const H = constants.PLAYER?.HEIGHT ?? 1.8
  const EYE = constants.PLAYER?.EYE_HEIGHT ?? 1.62
  const boxCenterY = H / 2
  const faceY = EYE - 0.17

  const bodyGeom = useMemo(() => <boxGeometry args={[0.7, H, 0.7]} />, [H])
  const faceGeom = useMemo(() => <planeGeometry args={[0.7, 0.7]} />, [])
  const bodyMat = useMemo(() => {
    const base = p.color && /^#([0-9a-fA-F]{6})$/.test(p.color) ? p.color : '#f0b46d'
    const col = isIt ? '#ff5d5d' : base
    return <meshStandardMaterial color={col} />
  }, [isIt, p.color])

  // Face texture: prefer user-drawn faceData if present; otherwise render smile overlay from base
  const [faceVersion, setFaceVersion] = useState(0)
  const customFaceTexRef = useRef<THREE.Texture | null>(null)
  useEffect(() => {
    let disposed = false
    const cleanup = () => {
      if (customFaceTexRef.current) {
        try { customFaceTexRef.current.dispose() } catch {}
        customFaceTexRef.current = null
      }
    }
    if (p.faceData && typeof p.faceData === 'string' && p.faceData.startsWith('data:image/png')) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (disposed) return
        const c = document.createElement('canvas')
        c.width = 256; c.height = 256
        const ctx = c.getContext('2d')!
        ctx.clearRect(0, 0, 256, 256)
        ctx.drawImage(img, 0, 0, 256, 256)
        const tx = new THREE.CanvasTexture(c)
        tx.colorSpace = THREE.SRGBColorSpace
        tx.minFilter = THREE.LinearFilter
        tx.magFilter = THREE.LinearFilter
        tx.needsUpdate = true
        customFaceTexRef.current = tx
        setFaceVersion(v => v + 1)
      }
      img.src = p.faceData
      return () => { disposed = true; cleanup() }
    } else {
      cleanup()
    }
  }, [p.faceData])

  const defaultSmileTexture = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256; c.height = 256
    const ctx = c.getContext('2d')!
    // Only draw base face if NO custom face data is present
    if (!p.faceData) {
      // draw only the base face (no smile overlay)
      ctx.drawImage((baseFaceTexture as any).image, 0, 0, c.width, c.height)
    }
    const tx = new THREE.CanvasTexture(c)
    tx.colorSpace = THREE.SRGBColorSpace
    tx.minFilter = THREE.LinearFilter
    tx.magFilter = THREE.LinearFilter
    return tx
  }, [baseFaceTexture, faceVersion, p.faceData])

  // Hat accessory meshes
  const hatMesh = useMemo(() => {
    if (p.hat === 'none') return null
    const y = EYE + 0.05
    if (p.hat === 'cap') {
      return (
        <group>
          <mesh position={[0, y + 0.02, 0]} castShadow>
            <sphereGeometry args={[0.38, 16, 12]} />
            <meshStandardMaterial color="#222a3d" roughness={0.6} metalness={0.2} />
          </mesh>
          <mesh position={[0, y - 0.06, -0.22]} rotation={[Math.PI/2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.12, 0.35, 12]} />
            <meshStandardMaterial color="#222a3d" roughness={0.6} metalness={0.2} />
          </mesh>
        </group>
      )
    }
    if (p.hat === 'cone') {
      return (
        <mesh position={[0, y + 0.12, 0]} castShadow>
          <coneGeometry args={[0.32, 0.7, 16]} />
          <meshStandardMaterial color="#ffb347" roughness={0.5} metalness={0.1} />
        </mesh>
      )
    }
    if (p.hat === 'halo') {
      return (
        <mesh position={[0, y + 0.25, 0]} rotation={[Math.PI/2,0,0]}>
          <torusGeometry args={[0.42, 0.07, 16, 32]} />
          <meshStandardMaterial color="#ffe066" emissive="#ffea8a" emissiveIntensity={0.8} metalness={0.3} roughness={0.2} />
        </mesh>
      )
    }
    return null
  }, [p.hat])

  return (
    <group position={p.pos as any} rotation={[0, p.yaw, 0]}>
      {!isSelf && (
        <>
          <mesh position={[0, boxCenterY, 0]} castShadow receiveShadow>
            {bodyGeom}
            {bodyMat}
          </mesh>
          <mesh position={[0, faceY, -0.36]} rotation={[0, Math.PI, 0]}>
            {faceGeom}
            <meshBasicMaterial map={customFaceTexRef.current || defaultSmileTexture} transparent side={THREE.DoubleSide} />
          </mesh>
          {hatMesh}
          <NameTag name={p.name} y={EYE + 0.35} />
        </>
      )}
    </group>
  )
})

/**
 * First-person camera with view-only effects (server authoritative).
 * Adds gentle smoothing, speed FOV, bob/sway, strafe tilt, wallrun roll,
 * slide pitch, and a landing kick. Defensive clamp on dt guards long frames.
 */
function FPCamera({ me, inputRef }: { me: NetPlayer | null; inputRef: React.RefObject<InputState> }) {
  const { camera } = useThree()

  // Persistent bases (no FX applied here)
  const baseYawRef = useRef(0)
  const basePitchRef = useRef(0)

  // FX state
  const fovRef = useRef(80)
  const baseRoll = useRef(0) // strafe/wallrun roll
  const swayRoll = useRef(0) // L/R swing → roll
  const swayYaw = useRef(0) // L/R swing → tiny yaw
  const swayPitch = useRef(0) // subtle vertical beat
  const pitchFx = useRef(0) // slide/landing pitch bias
  const phase = useRef(0) // swing phase

  const prevMode = useRef<string | null>(null)
  const prevOnG = useRef<boolean>(false)

  // Landing vertical dip (positional)
  const landY = useRef(0) // additive to camera.position.y
  const eyeYOffset = useRef(0) // slide/crouch lowers the eye height smoothly
  const eyeYVel = useRef(0) // damping velocity store for eyeYOffset
  const slideBobY = useRef(0) // gentle vertical oscillation during slide
  const slidePhase = useRef(0)
  const slidePitch = useRef(0) // smoothed slide pitch
  const slidePitchVel = useRef(0)

  // Tunables
  const EYE_HEIGHT = 1.62
  const EYE_HEIGHT_SLIDE = 1.28
  let BASE_FOV = getSettings().fov || 80
  let MAX_FOV = Math.max(BASE_FOV, BASE_FOV + 16)
  const SPEED_FOV_GAIN = 0.14

  const SWAY_FREQ_BASE = 1.4
  const SWAY_ROLL_AMP = 0.035
  const SWAY_YAW_AMP = 0.009
  const SWAY_PITCH_AMP = 0.004
  const SWAY_SPEED_REF = 7.5
  const SWAY_RESP = 14.0

  const STRAFE_TILT = 0.04
  const WALL_ROLL = 0.18
  const SLIDE_PITCH = -0.08

  const LAND_KICK = -0.065
  const LAND_DIP_Y = -0.1
  const LAND_RECOVER = 10.0
  // Slide bob parameters (slow, subtle)
  const SLIDE_BOB_AMP = 0.05
  const SLIDE_BOB_FREQ = 0.9

  // Critically-damped smoothing (Unity-like SmoothDamp)
  function smoothDamp(current: number, target: number, velRef: React.MutableRefObject<number>, smoothTime: number, dt: number, maxSpeed = Infinity) {
    const st = Math.max(0.0001, smoothTime)
    const omega = 2 / st
    const x = omega * dt
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
    let change = current - target
    const maxChange = maxSpeed * st
    if (Math.abs(change) > maxChange) change = Math.sign(change) * maxChange
    const temp = (velRef.current + omega * change) * dt
    velRef.current = (velRef.current - omega * temp) * exp
    return target + (change + temp) * exp
  }

  useEffect(() => {
    if (!me) return
    // initialize bases from current camera/me to avoid a jump on first frame
    baseYawRef.current = inputRef.current?.yaw ?? me.yaw
    basePitchRef.current = inputRef.current?.pitch ?? me.pitch
    prevMode.current = me.mode
    prevOnG.current = !!me.onGround
    // Also update the camera immediately to prevent a single-frame mismatch
    camera.rotation.order = 'YXZ'
    camera.rotation.y = baseYawRef.current
    camera.rotation.x = basePitchRef.current
  }, [me, inputRef, camera])

  useFrame((_, rawDt) => {
    if (!me) return
    // refresh FOV from settings
    BASE_FOV = getSettings().fov || 80
    MAX_FOV = Math.max(BASE_FOV, BASE_FOV + 16)

    // Defend against long frames when tab resumes
    const dt = Math.min(rawDt, 1 / 15) // clamp to ~66 ms

    // ---------- Authoritative position (no positional bob) ----------
    const eyeX = me.pos[0]
    // Smoothly ease eye height towards crouched height when sliding
  const targetEyeOffset = me.mode === 'slide' ? (EYE_HEIGHT_SLIDE - EYE_HEIGHT) : 0
  // Smoothly ease using critically-damped smoothing to avoid pops when entering/exiting slide
  eyeYOffset.current = smoothDamp(eyeYOffset.current, targetEyeOffset, eyeYVel, 0.12, dt)
    // Slide bob: slow up/down while in slide, decay otherwise
    if (me.mode === 'slide') {
      slidePhase.current += dt * SLIDE_BOB_FREQ * Math.PI * 2
      const targetBob = SLIDE_BOB_AMP * Math.sin(slidePhase.current)
      slideBobY.current += (targetBob - slideBobY.current) * Math.min(1, dt * 6)
    } else {
      slideBobY.current += (0 - slideBobY.current) * Math.min(1, dt * 5)
    }
    const eyeY = me.pos[1] + EYE_HEIGHT + eyeYOffset.current
    const eyeZ = me.pos[2]
    camera.position.x += (eyeX - camera.position.x) * Math.min(1, dt * 10)
    camera.position.y += (eyeY - camera.position.y) * Math.min(1, dt * 12)
    camera.position.z += (eyeZ - camera.position.z) * Math.min(1, dt * 10)

    // ---------- Base yaw/pitch (separate from effects to avoid feedback) ----------
    const targetYaw = inputRef.current?.yaw ?? me.yaw
    const targetPitch = inputRef.current?.pitch ?? me.pitch
    const oriK = Math.min(1, dt * 12)
    baseYawRef.current += (targetYaw - baseYawRef.current) * oriK
    basePitchRef.current += (targetPitch - basePitchRef.current) * oriK

    // ---------- Speed-based FOV ----------
    const speed = Math.hypot(me.vel[0], me.vel[2])
    const targetFov = Math.max(BASE_FOV, Math.min(MAX_FOV, BASE_FOV + speed * SPEED_FOV_GAIN))
    fovRef.current += (targetFov - fovRef.current) * Math.min(1, dt * 2.5)

    // ---------- Bob / sway driver ----------
  const groundedStrict = !!me.onGround || me.mode === 'ground' || me.mode === 'slide'
    const disallowBob = me.mode === 'wallrunL' || me.mode === 'wallrunR' || me.mode === 'mantle'
    const canBob = groundedStrict && !disallowBob

    const moving = speed > 0.2
    const ampScale = canBob && moving ? Math.max(0.6, Math.min(1.4, speed / SWAY_SPEED_REF)) : 0
    const freq = SWAY_FREQ_BASE * Math.max(0.9, Math.min(1.3, speed / SWAY_SPEED_REF))

    // Keep phase continuous, even if amp is zero
    phase.current += dt * freq * Math.PI * 2

    const sin1 = Math.sin(phase.current)
    const sin2 = Math.sin(phase.current * 2.0)

    const targetSwayRoll = -(SWAY_ROLL_AMP * ampScale) * sin1
    const targetSwayYaw = -(SWAY_YAW_AMP * ampScale) * sin1
    const targetSwayPitch = SWAY_PITCH_AMP * ampScale * sin2

    const sK = Math.min(1, dt * SWAY_RESP)
    swayRoll.current += (targetSwayRoll - swayRoll.current) * sK
    swayYaw.current += (targetSwayYaw - swayYaw.current) * sK
    swayPitch.current += (targetSwayPitch - swayPitch.current) * sK

    // ---------- Strafe tilt + wall-run roll ----------
    const inpt = inputRef.current
    const strafe = (inpt?.left ? -1 : 0) + (inpt?.right ? 1 : 0)
    const strafeRoll = -STRAFE_TILT * strafe

    let modeRoll = 0
    if (me.mode === 'wallrunL') modeRoll = WALL_ROLL
    if (me.mode === 'wallrunR') modeRoll = -WALL_ROLL

    const targetBaseRoll = strafeRoll + modeRoll
    baseRoll.current += (targetBaseRoll - baseRoll.current) * Math.min(1, dt * 8)

    // ---------- Slide pitch + landing effects ----------
  // Smooth slide pitch in/out instead of instant
  const targetSlidePitch = me.mode === 'slide' ? SLIDE_PITCH : 0
  slidePitch.current = smoothDamp(slidePitch.current, targetSlidePitch, slidePitchVel, 0.12, dt)
  let pitchBias = slidePitch.current

    const wasMode = prevMode.current
    const wasOnG = prevOnG.current
    const nowOnG = !!me.onGround

    const justLandedByMode =
      (wasMode === 'air' || wasMode === 'wallrunL' || wasMode === 'wallrunR' || wasMode === 'mantle') &&
      me.mode === 'ground'
    const justLandedByFlag = !wasOnG && nowOnG

    if (justLandedByMode || justLandedByFlag) {
      pitchFx.current = LAND_KICK
      landY.current = LAND_DIP_Y
    }
    prevMode.current = me.mode
    prevOnG.current = nowOnG

    // Recover pitch and vertical dip smoothly
    if (pitchFx.current !== 0) {
      const recP = Math.sign(-pitchFx.current) * Math.min(Math.abs(pitchFx.current), LAND_RECOVER * dt)
      pitchFx.current += recP
      if (Math.abs(pitchFx.current) < 1e-3) pitchFx.current = 0
    }
    if (landY.current !== 0) {
      const recY = (0 - landY.current) * Math.min(1, dt * LAND_RECOVER)
      landY.current += recY
      if (Math.abs(landY.current) < 1e-4) landY.current = 0
    }

    // ---------- Compose final orientation ----------
    camera.rotation.order = 'YXZ'
    camera.rotation.y = baseYawRef.current + swayYaw.current
  camera.rotation.x = basePitchRef.current + (pitchBias + pitchFx.current) + swayPitch.current
    camera.rotation.z = baseRoll.current + swayRoll.current

    // Apply landing vertical dip after positional smoothing so it is visible
  camera.position.y += landY.current + slideBobY.current

    ;(camera as any).fov = fovRef.current
    camera.updateProjectionMatrix()
  })

  return null
}

function PauseMenu({ socket, onClose }: { socket: Socket, onClose: () => void }) {
  useEffect(() => {
    try { if (document.pointerLockElement) document.exitPointerLock() } catch {}
  }, [])
  return (
    <div id="pause-overlay" style={{ position:'fixed', inset:0, background:'rgba(8,12,24,0.65)', backdropFilter:'blur(6px)', zIndex: 1200, display:'grid', placeItems:'center', padding: 20 }}>
      <div className="panel" style={{ width: 'min(720px, 96vw)' }}>
        <h1>Paused</h1>
        <div className="actions" style={{ marginBottom: 12 }}>
          <button onClick={onClose}>Resume</button>
          <button className="secondary" onClick={() => socket.disconnect()}>Leave</button>
        </div>
        <SettingsPanel />
      </div>
    </div>
  )
}

function SettingsPanel() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const unsub = subscribe(() => setTick(t => t + 1))
    return () => { try { unsub() } catch {} }
  }, [])
  const s = getSettings()
  return (
    <div style={{ display:'grid', gap:12 }}>
      <div>
        <label>Field of View ({Math.round(s.fov)})</label>
        <input type="range" min={70} max={110} step={1} value={s.fov} onChange={e => setSettings({ fov: Number(e.target.value) })} />
      </div>
      <div>
        <label>Mouse Sensitivity ({s.sensitivity.toFixed(4)})</label>
        <input type="range" min={0.0008} max={0.006} step={0.0001} value={s.sensitivity} onChange={e => setSettings({ sensitivity: Number(e.target.value) })} />
      </div>
      <div style={{ display:'flex', gap:12, alignItems:'center' }}>
        <label style={{ margin:0 }}>Invert Y</label>
        <input type="checkbox" checked={s.invertY} onChange={e => setSettings({ invertY: e.target.checked })} />
      </div>
      <div>
        <label>Max Render Scale ({s.maxDpr.toFixed(2)}x)</label>
        <input type="range" min={0.75} max={2.0} step={0.05} value={s.maxDpr} onChange={e => setSettings({ maxDpr: Number(e.target.value) })} />
      </div>
      <div>
        <label>Master Volume ({Math.round((s.masterVolume ?? 1) * 100)}%)</label>
        <input type="range" min={0} max={1} step={0.01} value={s.masterVolume} onChange={e => setSettings({ masterVolume: Number(e.target.value) })} />
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        <button className="secondary" onClick={() => resetSettings()}>Reset to Defaults</button>
      </div>
    </div>
  )
}

// Simple sprite-based name tag that fades in when the camera is close
function NameTag({ name, y }: { name: string; y: number }) {
  const { camera } = useThree()
  const spriteRef = useRef<THREE.Sprite>(null)

  const texture = useMemo(() => {
    const cnv = document.createElement('canvas')
    cnv.width = 512; cnv.height = 128
    const ctx = cnv.getContext('2d')!
    ctx.clearRect(0, 0, cnv.width, cnv.height)
    // background bubble
    const pad = 18
    const r = 24
    const w = cnv.width - pad * 2
    const h = 64
    const x = pad
    const y0 = (cnv.height - h) / 2
    ctx.fillStyle = 'rgba(13,20,48,0.75)'
    ctx.strokeStyle = 'rgba(60,92,255,0.8)'
    ctx.lineWidth = 3
    roundRect(ctx, x, y0, w, h, r, true, true)
    ctx.font = 'bold 48px system-ui, Arial, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(name, cnv.width / 2, cnv.height / 2)
    const tx = new THREE.CanvasTexture(cnv)
    tx.colorSpace = THREE.SRGBColorSpace
    tx.anisotropy = 4
    tx.minFilter = THREE.LinearFilter
    tx.magFilter = THREE.LinearFilter
    tx.needsUpdate = true
    return tx
  }, [name])

  const mat = useMemo(() => new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }), [texture])

  // Distance-based fade
  useFrame(() => {
    const sp = spriteRef.current
    if (!sp) return
    const worldPos = new THREE.Vector3()
    sp.getWorldPosition(worldPos)
    const d = worldPos.distanceTo(camera.position)
    const SHOW = 12
    const START = 8
    const clamped = Math.max(0, Math.min(1, (SHOW - d) / (SHOW - START)))
    mat.opacity = clamped
    sp.visible = clamped > 0.02
    // scale nameplate mildly with distance for readability
    const baseW = 1.2
    const baseH = 0.3
    const scale = 1 + Math.max(0, (START - Math.min(d, START)) * 0.05)
    sp.scale.set(baseW * scale, baseH * scale, 1)
  })

  return (
    <sprite ref={spriteRef} material={mat} position={[0, y, 0]} />
  )
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, fill: boolean, stroke: boolean) {
  if (radius < 0) radius = 0
  const r = Math.min(radius, height / 2, width / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  if (fill) ctx.fill()
  if (stroke) ctx.stroke()
}

// Preload core textures so new joiners see assets immediately
function PreloadAssets() {
  // These imports ensure Vite includes the assets and useLoader caches them
  const urls = useMemo(
    () => [
      faceTexturePath,
      new URL('../../assets/textures/floor_grid.png', import.meta.url).toString(),
      new URL('../../assets/textures/wall_noise.png', import.meta.url).toString()
    ],
    []
  )
  useLoader(TextureLoader, urls)
  return null
}
