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
// Import the face texture so Vite copies it into dist; absolute /assets paths were not bundled.
import faceTexturePath from '../../assets/textures/face.png'
import constants from '../../../shared/constants.json'

export default function Game({ socket, selfId }: { socket: Socket; selfId: string }) {
  const inputRef = useFPControls(socket)
  const [results, setResults] = useState<RoundResults | null>(null)
  const [maps, setMaps] = useState<string[]>([])
  const [mapName, setMapName] = useState<string>('')

  const bufferRef = useRef(new SnapshotBuffer())
  const [snap, setSnap] = useState<Snapshot | null>(null)

  // Socket listeners with stable refs for proper cleanup
  useEffect(() => {
    const onSnap = (s: Snapshot) => {
      bufferRef.current.push(s)
    }

    const onResults = (r: RoundResults) => setResults(r)

    const onLobbyUpdate = (p: { maps?: string[]; mapName?: string }) => {
      if (p?.maps) setMaps(p.maps)
      if (p?.mapName) setMapName(p.mapName)
    }

    const onSfx = (e: { kind?: string; id?: string; target?: string }) => {
      const kind = String(e?.kind ?? '').toLowerCase()
      const map: Record<string, string> = {
        jump: 'jump',
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

    socket.on('world:snapshot', onSnap)
    socket.on('round:results', onResults)
    socket.on('lobby:update', onLobbyUpdate)
    socket.on('sfx', onSfx)

    return () => {
      socket.off('world:snapshot', onSnap)
      socket.off('round:results', onResults)
      socket.off('lobby:update', onLobbyUpdate)
      socket.off('sfx', onSfx)
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

  const me = useMemo(() => snap?.players.find(p => p.id === selfId) ?? null, [snap, selfId])

  return (
    <>
      {/* Limit device pixel ratio to reduce GPU load on low-end machines */}
      <Canvas
        camera={{ position: [0, 2, 4], fov: 80 }}
        shadows
        dpr={Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.25)}
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
          {/* Match sun direction with main directional light position */}
          <Skybox sunDir={new THREE.Vector3(14,22,12).normalize().toArray()} />
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
          <MapMeshes />
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

      {snap && <Scoreboard scores={snap.scores} itId={snap.itId} />}
      <ResultsModal results={results} />
      {snap?.intermission && <MapVote socket={socket} maps={maps} current={snap.mapName} />}
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
const Avatar = memo(function Avatar({
  p,
  isSelf,
  isIt
}: {
  p: NetPlayer
  isSelf: boolean
  isIt: boolean
}) {
  const faceTexture = useLoader(TextureLoader, faceTexturePath)

  const H = constants.PLAYER?.HEIGHT ?? 1.8
  const EYE = constants.PLAYER?.EYE_HEIGHT ?? 1.62

  // Group origin at feet; body centered on Y by half-height
  const boxCenterY = H / 2
  const faceY = EYE - 0.17

  const bodyGeom = useMemo(() => <boxGeometry args={[0.7, H, 0.7]} />, [H])
  const faceGeom = useMemo(() => <planeGeometry args={[0.7, 0.7]} />, [])
  const bodyMat = useMemo(
    () => <meshStandardMaterial color={isIt ? '#ff5d5d' : '#f0b46d'} />,
    [isIt]
  )

  return (
    <group position={p.pos as any} rotation={[0, p.yaw, 0]}>
      {/* Do not render the local player's body or face in first-person */}
      {!isSelf && (
        <>
          <mesh position={[0, boxCenterY, 0]} castShadow receiveShadow>
            {bodyGeom}
            {bodyMat}
          </mesh>
          <mesh position={[0, faceY, -0.36]} rotation={[0, Math.PI, 0]}>
            {faceGeom}
            <meshBasicMaterial map={faceTexture} transparent />
          </mesh>
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

  // Tunables
  const EYE_HEIGHT = 1.62
  const BASE_FOV = 80
  const MAX_FOV = 96
  const SPEED_FOV_GAIN = 0.14

  const SWAY_FREQ_BASE = 1.4
  const SWAY_ROLL_AMP = 0.035
  const SWAY_YAW_AMP = 0.009
  const SWAY_PITCH_AMP = 0.004
  const SWAY_SPEED_REF = 7.5
  const SWAY_RESP = 14.0

  const STRAFE_TILT = 0.04
  const WALL_ROLL = 0.18
  // Removed slide mechanics; retain constant for potential future use placeholder
  const SLIDE_PITCH = 0

  const LAND_KICK = -0.065
  const LAND_DIP_Y = -0.1
  const LAND_RECOVER = 10.0

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

    // Defend against long frames when tab resumes
    const dt = Math.min(rawDt, 1 / 15) // clamp to ~66 ms

    // ---------- Authoritative position (no positional bob) ----------
    const eyeX = me.pos[0]
    const eyeY = me.pos[1] + EYE_HEIGHT
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
    const groundedStrict = !!me.onGround || me.mode === 'ground'
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

  // ---------- Landing effects ----------
    let pitchBias = 0
  // (slide removed)

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
    camera.position.y += landY.current

    ;(camera as any).fov = fovRef.current
    camera.updateProjectionMatrix()
  })

  return null
}
