import React, { Suspense, memo, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Socket } from 'socket.io-client'
import { useFPControls } from '../controls/useFPControls'
import { MapMeshes, pickMapData } from '../map'
import type { Snapshot, NetPlayer, RoundResults, InputState } from '../types'
import Scoreboard from './Scoreboard'
import ResultsModal from './ResultsModal'
import MapVote from './MapVote'
import { SnapshotBuffer } from './interp'
import { pulseScreen } from '../sfx'
import { playSfx } from '../assets'
import { initPositionalAudio, playSfx3D } from '../audio/positional'
import Skybox from './Skybox'
import { accessoryMesh } from './accessories'
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
      // If we can locate the player who caused the sound, play 3D with basic occlusion; otherwise fallback
  const sampled = bufferRef.current.sample()
  const actor = sampled?.players.find((p: NetPlayer) => p.id === (e.id || e.target))
      if (actor) {
        // naive occlusion: sample points along segment and count intersections to compute occlusion strength
        let occStrength = 0
        try {
          const mapData = pickMapData(snap?.mapName || mapName)
          if (mapData && Array.isArray(mapData.aabbs)) {
            const cam = (document as any).__r3f?.root?.getState?.().camera
            if (cam) {
              const A = new THREE.Vector3(cam.position.x, cam.position.y, cam.position.z)
              const B = new THREE.Vector3(actor.pos[0], actor.pos[1]+1.4, actor.pos[2])
              const dir = new THREE.Vector3().subVectors(B, A)
              const len = dir.length() || 1
              dir.normalize()
              // sample a few points along the segment and see if they are inside any obstacle horizontally at sampled height
              const steps = 14
              const R = (constants.PLAYER?.RADIUS ?? 0.35)
              let hits = 0
              for (let i = 1; i < steps; i++) {
                const t = i / steps
                const Pnt = new THREE.Vector3().copy(A).addScaledVector(dir, len * t)
                for (const b of mapData.aabbs) {
                  // expand by radius to be conservative
                  if (Pnt.x >= b.min[0]-R && Pnt.x <= b.max[0]+R && Pnt.z >= b.min[2]-R && Pnt.z <= b.max[2]+R && Pnt.y >= b.min[1] && Pnt.y <= b.max[1]) { hits++; break }
                }
              }
              occStrength = Math.max(0, Math.min(1, hits / (steps * 0.5)))
            }
          }
        } catch {}
        const cam = (document as any).__r3f?.root?.getState?.().camera
        const lisPos: [number,number,number] | undefined = cam ? [cam.position.x, cam.position.y, cam.position.z] : undefined
        playSfx3D(key as any, {
          position: [actor.pos[0], actor.pos[1]+1.2, actor.pos[2]],
          volume: 0.8,
          occlusion: occStrength,
          sourceVel: [actor.vel[0], actor.vel[1], actor.vel[2]],
          listenerPos: lisPos,
        })
      } else {
        try { playSfx(key as any) } catch {}
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
          {/* Sky & lighting adjust for dark mode */}
          <Skybox />
          {snap?.gameMode === 'dark' ? (
            <>
              <hemisphereLight args={['#6b7a88', '#0c1018', 0.7]} />
              <ambientLight intensity={0.18} />
              <directionalLight position={[14,22,12]} intensity={0.55} color={'#3a4b66'} />
            </>
          ) : (
            <>
              <hemisphereLight args={['#e3f2ff', '#242a35', 1.4]} />
              <ambientLight intensity={0.7} />
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
              <directionalLight position={[-10, 12, -8]} intensity={0.6} color={'#b8d4ff'} />
            </>
          )}
          {snap?.gameMode === 'dark' && <Flashlight me={me} />}
          <PreloadAssets />
          <MapMeshes name={snap?.mapName || mapName} />
          {snap?.players.map(p => (
            <Avatar key={p.id} p={p} isSelf={p.id === selfId} isIt={snap?.itId === p.id} />
          ))}
          {/* Grapple rope visuals */}
          {snap?.players.map(p => (
            <GrappleRope key={p.id+':rope'} p={p} />
          ))}
          <FPCamera me={me} inputRef={inputRef} mapName={snap?.mapName || mapName} />
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
  <ResultsModal results={results} onDismiss={() => setResults(null)} socket={socket} maps={maps} current={snap?.mapName || mapName} voteCounts={voteCounts} />
  {/* Map vote shown only during intermission; now used for pre-game vote as well */}
      {snap?.intermission && maps.length > 0 && !results && (
        <MapVote socket={socket} maps={maps} current={snap.mapName} voteCounts={voteCounts} />
      )}
      {paused && <PauseMenu socket={socket} onClose={() => { setPausedGlobal(false); setPaused(false) }} />}
      {/* Bottom-center chain bar */}
      {(() => {
        const ct = (me as any)?.chainT as number | undefined
        const active = typeof ct === 'number' && ct > 0
        if (!active) return null
        const total = (constants as any).CHAIN_TIME || 1
        const mult = (constants as any).CHAIN_SPEED_MULT || 1.2
        const pct = Math.max(0, Math.min(1, ct / total))
        return (
          <div style={{ position:'fixed', left:'50%', transform:'translateX(-50%)', bottom: 24, zIndex: 1000, width: 'min(60vw, 560px)' }}>
            <div style={{ display:'flex', justifyContent:'center', gap:8, fontWeight:700, letterSpacing:0.5, marginBottom: 6 }}>
              <span style={{ opacity:0.9 }}>Chain</span>
              <span style={{ color:'#7dd3fc' }}>{`x${Number(mult).toFixed(2)}`}</span>
            </div>
            <div style={{ height: 12, background:'#0b1326', borderRadius: 999, overflow:'hidden', boxShadow: '0 0 0 1px #1f2d53 inset, 0 8px 30px rgba(75,119,255,0.25)' }}>
              <div style={{ width: `${pct * 100}%`, height: '100%', background: 'linear-gradient(90deg,#6ee7ff,#3b82f6)', transition: 'width 80ms linear' }} />
            </div>
          </div>
        )
      })()}
  {/* IT Ability HUD (bottom-right) */}
  {(() => {
    if (!snap) return null
    if (snap.gameMode === 'noAbility') return null
    if (snap.itId !== selfId) return null
    const meP = snap.players.find(p => p.id === selfId)
    if (!meP) return null
    const ability = meP.itAbility || 'none'
    if (ability === 'none') return null
    const dashT = (meP as any).itDashT || 0
    const dashCd = (meP as any).itDashCd || 0
    const gAct = (meP as any).itGrappleActive || false
    const gCd = (meP as any).itGrappleCd || 0
    const boxStyle: React.CSSProperties = { position:'fixed', right:18, bottom:24, background:'#0d1528', padding:'12px 16px', borderRadius:12, width:200, fontSize:14, boxShadow:'0 6px 24px rgba(0,0,0,0.4)', border:'1px solid #1f2d46' }
    const bar = (value: number, max: number, colorA = '#60a5fa', colorB = '#2563eb') => {
      const pct = Math.max(0, Math.min(1, value / max))
      return <div style={{ height:8, background:'#16253c', borderRadius:4, overflow:'hidden', boxShadow:'0 0 0 1px #203352 inset', marginTop:6 }}><div style={{ width:`${pct*100}%`, height:'100%', background:`linear-gradient(90deg,${colorA},${colorB})`, transition:'width 120ms linear' }} /></div>
    }
    if (ability === 'dash') {
      const cdTotal = (constants.IT?.DASH_COOLDOWN || 6)
      return (
        <div style={boxStyle}>
          <div style={{ fontWeight:600, letterSpacing:0.5 }}>Dash Ability</div>
          {dashT > 0 ? <div style={{ color:'#7dd3fc', marginTop:4 }}>Active {dashT.toFixed(2)}s</div> : <div style={{ opacity:0.8, marginTop:4 }}>{dashCd > 0 ? `Cooldown ${dashCd.toFixed(1)}s` : 'Ready (Q)'}</div>}
          {bar(cdTotal - dashCd, cdTotal)}
        </div>
      )
    }
    if (ability === 'grapple') {
      const cdTotal = (constants.IT?.GRAPPLE_COOLDOWN || 8)
      return (
        <div style={boxStyle}>
          <div style={{ fontWeight:600, letterSpacing:0.5 }}>Grapple Ability</div>
          <div style={{ marginTop:4, color: gAct ? '#7dd3fc' : (gCd>0?'#9ca3af':'#7dd3fc') }}>{gAct ? 'Pulling...' : (gCd>0 ? `Cooldown ${gCd.toFixed(1)}s` : 'Ready (Q)')}</div>
          {bar(cdTotal - gCd, cdTotal, '#34d399', '#059669')}
        </div>
      )
    }
    return null
  })()}
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

  const hatMesh = useMemo(() => accessoryMesh(p.hat as any, EYE, faceY, 'game'), [p.hat, EYE, faceY])

  // Third-person simple animations: lean/tilt on wallrun and slide
  const animRef = useRef<THREE.Group>(null)
  const tilt = useRef({ roll: 0, pitch: 0, y: 0 })
  useFrame((_, dt) => {
    if (!animRef.current || isSelf) return
    const speed = Math.hypot(p.vel[0], p.vel[2])
    let targetRoll = 0
    let targetPitch = 0
    let targetY = 0
    if (p.mode === 'wallrunL') targetRoll = 0.28
    else if (p.mode === 'wallrunR') targetRoll = -0.28
    if (p.mode === 'slide') {
      targetPitch = -0.22
      // small lateral roll proportional to lateral component along right vector
      const rt = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)]
      const lateral = p.vel[0]*rt[0] + p.vel[2]*rt[2]
      targetRoll += Math.max(-0.08, Math.min(0.08, -lateral * 0.01))
      targetY = -0.18
    }
    const k = Math.min(1, dt * 10)
    tilt.current.roll += (targetRoll - tilt.current.roll) * k
    tilt.current.pitch += (targetPitch - tilt.current.pitch) * k
    tilt.current.y += (targetY - tilt.current.y) * k
    animRef.current.rotation.set(tilt.current.pitch, 0, tilt.current.roll)
    animRef.current.position.y = tilt.current.y
  })

  return (
    <group position={p.pos as any} rotation={[0, p.yaw, 0]}>
      {!isSelf && (
        <group ref={animRef}>
          <mesh position={[0, boxCenterY, 0]} castShadow receiveShadow>
            {bodyGeom}
            {bodyMat}
          </mesh>
          <mesh position={[0, faceY, -0.36]} rotation={[0, Math.PI, 0]}>
            {faceGeom}
            <meshBasicMaterial map={customFaceTexRef.current || defaultSmileTexture} transparent side={THREE.DoubleSide} />
          </mesh>
          {hatMesh}
          <NameTag name={p.name} y={EYE + 0.6} />
        </group>
      )}
    </group>
  )
})

/**
 * First-person camera with view-only effects (server authoritative).
 * Adds gentle smoothing, speed FOV, bob/sway, strafe tilt, wallrun roll,
 * slide pitch, and a landing kick. Defensive clamp on dt guards long frames.
 */
function FPCamera({ me, inputRef, mapName }: { me: NetPlayer | null; inputRef: React.RefObject<InputState>; mapName?: string }) {
  const { camera } = useThree()
  useEffect(() => { try { initPositionalAudio(camera) } catch {} }, [camera])

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
  const slideRollRef = useRef(0) // smoothed sideways roll while sliding
  const slideRollVel = useRef(0)

  // Tunables
  const EYE_HEIGHT = 1.62
  const EYE_HEIGHT_SLIDE = 1.20 // lowered further for stronger slide feel
  const EYE_HEIGHT_CROUCH = 1.48
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
    const baseOffset = me.mode === 'slide'
      ? (EYE_HEIGHT_SLIDE - EYE_HEIGHT) - 0.06 // extra drop for slide visual only
      : (me.mode === 'crouch' ? (EYE_HEIGHT_CROUCH - EYE_HEIGHT) : 0)
    const targetEyeOffset = baseOffset
    // Make downward drop faster when entering slide, and rise back up a bit slower when exiting
    const goingDown = targetEyeOffset < eyeYOffset.current // target is more negative than current
    const smoothTime = goingDown ? 0.06 : 0.14
    // Critically-damped smoothing avoids pops when entering/exiting slide
    eyeYOffset.current = smoothDamp(eyeYOffset.current, targetEyeOffset, eyeYVel, smoothTime, dt)
    // Slide bob: slow up/down while in slide, decay otherwise
    if (me.mode === 'slide') {
      // Fully suppress slide vertical bob; aggressively decay any residual
      slideBobY.current += (0 - slideBobY.current) * Math.min(1, dt * 12)
    } else {
      // (kept for potential future crouch-specific bob)
      slideBobY.current += (0 - slideBobY.current) * Math.min(1, dt * 5)
    }
  let eyeYTarget = me.pos[1] + EYE_HEIGHT + eyeYOffset.current
  // Smooth clamp state
  const clampVelRef = (FPCamera as any)._clampVelRef || ((FPCamera as any)._clampVelRef = { v: 0 })
  const clampOffsetRef = (FPCamera as any)._clampOffsetRef || ((FPCamera as any)._clampOffsetRef = { value: 0 })
    // Improved dynamic ceiling clamp: detect any AABB overhead whose underside intersects the vertical column above player.
    try {
      const mapData = pickMapData(mapName)
      if (mapData && Array.isArray(mapData.aabbs)) {
        const R = constants.PLAYER?.RADIUS ?? 0.35
        // Track a smoothed ceiling and sticky clamp to avoid jitter under low platforms
        const sticky = (FPCamera as any)._ceilSticky || ((FPCamera as any)._ceilSticky = { y: Infinity, active: false })
        let nearest = Infinity
        for (const b of mapData.aabbs) {
          const horiz = (me.pos[0] >= b.min[0] - R && me.pos[0] <= b.max[0] + R && me.pos[2] >= b.min[2] - R && me.pos[2] <= b.max[2] + R)
          if (!horiz) continue
          if (b.min[1] > me.pos[1] + 0.2 && b.min[1] < nearest) nearest = b.min[1]
        }
        // Low-pass the ceiling height to avoid frame-to-frame toggles
        if (nearest !== Infinity) {
          if (!Number.isFinite(sticky.y) || sticky.y === Infinity) sticky.y = nearest
          const lerp = Math.min(1, dt * 20)
          sticky.y = sticky.y + (nearest - sticky.y) * lerp
        } else {
          // When no ceiling, ease toward Infinity by releasing sticky
          sticky.y = Infinity
        }
        if (sticky.y !== Infinity) {
          const baseMargin = 0.14
          const targetPitch = inputRef.current?.pitch ?? me.pitch
          const lookUpFactor = Math.max(0, targetPitch)
          const extra = Math.min(0.18, lookUpFactor * 0.25)
          const margin = baseMargin + extra
          const clampY = sticky.y - margin
          // Activate sticky clamp if head would cross the ceiling minus margin,
          // keep active until there's comfortable clearance (hysteresis)
          const hysteresis = 0.06
          const wouldClip = eyeYTarget > clampY
          if (wouldClip) sticky.active = true
          if (sticky.active && (eyeYTarget < clampY - hysteresis)) sticky.active = false
          if (sticky.active) eyeYTarget = Math.min(eyeYTarget, clampY)
        }
      }
    } catch {}
    const eyeY = eyeYTarget
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
    const groundedStrict = !!me.onGround || me.mode === 'ground' || me.mode === 'crouch'
    const disallowBob = me.mode === 'wallrunL' || me.mode === 'wallrunR' || me.mode === 'mantle' || me.mode === 'slide'
    const canBob = groundedStrict && !disallowBob

    const moving = speed > 0.2
    const ampScale = canBob && moving ? Math.max(0.6, Math.min(1.4, speed / SWAY_SPEED_REF)) : 0
    const freq = SWAY_FREQ_BASE * Math.max(0.9, Math.min(1.3, speed / SWAY_SPEED_REF))

    // Keep phase continuous, even if amp is zero
    phase.current += dt * freq * Math.PI * 2

    if (me.mode === 'slide') {
      // Decay sway components while sliding (no bob)
      const decay = Math.min(1, dt * 10)
      swayRoll.current *= (1 - decay)
      swayYaw.current *= (1 - decay)
      swayPitch.current *= (1 - decay)
    } else {
      const sin1 = Math.sin(phase.current)
      const sin2 = Math.sin(phase.current * 2.0)
      const targetSwayRoll = -(SWAY_ROLL_AMP * ampScale) * sin1
      const targetSwayYaw = -(SWAY_YAW_AMP * ampScale) * sin1
      const targetSwayPitch = SWAY_PITCH_AMP * ampScale * sin2
      const sK = Math.min(1, dt * SWAY_RESP)
      swayRoll.current += (targetSwayRoll - swayRoll.current) * sK
      swayYaw.current += (targetSwayYaw - swayYaw.current) * sK
      swayPitch.current += (targetSwayPitch - swayPitch.current) * sK
    }

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
    // Smoothed slide roll: target about -5deg with small lateral variation, quick ease in/out
    const rtVec = [Math.cos(me.yaw), 0, -Math.sin(me.yaw)]
    const lateral = me.vel[0] * rtVec[0] + me.vel[2] * rtVec[2]
    const lateralAdj = Math.max(-0.02, Math.min(0.02, -lateral * 0.01))
    const targetSlideRoll = me.mode === 'slide' ? (-0.087266 + lateralAdj) : 0 // -5deg in radians
    const rollSmoothTime = me.mode === 'slide' ? 0.08 : 0.12
    slideRollRef.current = smoothDamp(slideRollRef.current, targetSlideRoll, slideRollVel, rollSmoothTime, dt)
    camera.rotation.z = baseRoll.current + swayRoll.current + slideRollRef.current

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

// Flashlight component for dark mode (spotlight from player camera)
function Flashlight({ me }: { me: NetPlayer | null }) {
  const { camera, scene } = useThree()
  const lightRef = useRef<THREE.SpotLight>(null)
  useFrame(() => {
    if (!lightRef.current || !me) return
    lightRef.current.position.copy(camera.position)
    // Aim where camera looks
    const dir = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion)
    lightRef.current.target.position.copy(camera.position.clone().add(dir.multiplyScalar(10)))
    lightRef.current.target.updateMatrixWorld()
  })
  return (
    <>
      <spotLight ref={lightRef} angle={0.5} penumbra={0.35} intensity={3.2} distance={40} color="#e0ecff" castShadow />
      <pointLight position={[camera.position.x, camera.position.y, camera.position.z]} intensity={0.3} distance={8} color="#9fc5ff" />
    </>
  )
}

// Renders a dynamic line from IT player to grapple target while active
function GrappleRope({ p }: { p: NetPlayer }) {
  const geomRef = useRef<THREE.BufferGeometry>()
  const matRef = useRef<THREE.LineBasicMaterial>()
  const lineRef = useRef<THREE.Line>()
  // Lazy init
  if (!geomRef.current) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3))
    geomRef.current = g
  }
  if (!matRef.current) {
    matRef.current = new THREE.LineBasicMaterial({ color:'#34d399', transparent:true, opacity:0.85 })
  }
  if (!lineRef.current) {
    lineRef.current = new THREE.Line(geomRef.current, matRef.current)
  }
  useFrame(() => {
    if (!lineRef.current || !geomRef.current || !matRef.current) return
    const active = p.itGrappleActive && p.itGrappleTarget
    lineRef.current.visible = !!active
    if (!active) return
    const start = new THREE.Vector3(p.pos[0], p.pos[1] + (constants.PLAYER?.HEIGHT ?? 1.8) * 0.55, p.pos[2])
    const end = new THREE.Vector3(p.itGrappleTarget!.x, p.itGrappleTarget!.y, p.itGrappleTarget!.z)
    const posAttr = geomRef.current.getAttribute('position') as THREE.BufferAttribute
    posAttr.setXYZ(0, start.x, start.y, start.z)
    posAttr.setXYZ(1, end.x, end.y, end.z)
    posAttr.needsUpdate = true
    // Pulse rope color
    const t = performance.now() * 0.001
    const pul = (Math.sin(t * 5.6) * 0.5 + 0.5) * 0.35 + 0.65
    matRef.current.color.setRGB(0.18 * pul, 0.85 * pul, 0.55 * pul)
  })
  return <primitive object={lineRef.current!} />
}
