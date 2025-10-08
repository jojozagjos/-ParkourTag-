import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { Socket } from 'socket.io-client'
import { useFPControls } from '../controls/useFPControls'
import { MapMeshes } from '../map'
import type { Snapshot, NetPlayer, RoundResults } from '../types'
import Scoreboard from './Scoreboard'
import ResultsModal from './ResultsModal'
import MapVote from './MapVote'
import { SnapshotBuffer } from '../interp'
import { pulseScreen } from '../sfx'
import { playSfx } from '../assets'
import Skybox from './Skybox'

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
      try { playSfx(key as any) } catch (err) { /* ignore */ }
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
  {/* Hemisphere for nice top/bottom lighting */}
  <hemisphereLight args={["#e6f7ff", "#44404a", 0.9]} />
  <ambientLight intensity={0.5} />
  <directionalLight position={[10, 14, 6]} intensity={1.2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-bias={-0.0005} />
        <MapMeshes />
        {snap?.players.map(p => <Avatar key={p.id} p={p} isSelf={p.id === selfId} isIt={snap?.itId === p.id} />)}
  <FPCamera me={me || null} />
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
  return (
    <group position={p.pos as any} rotation={[0, p.yaw, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.7, 1.8, 0.7]} />
        {/* cast props to any to avoid strict fiber material prop typing */}
        <meshStandardMaterial {...({ color: isSelf ? '#6bd3ff' : (isIt ? '#ff5d5d' : '#f0b46d') } as any)} />
      </mesh>
    </group>
  )
}

function FPCamera({ me }: { me: NetPlayer | null }) {
  const { camera } = useThree()
  const camAny = camera as any
  const rollRef = useRef(0)
  const bobRef = useRef(0)
  useFrame((_, dt) => {
    if (!me) return
    const eye = [me.pos[0], me.pos[1] + 1.62, me.pos[2]]
    camera.position.x += (eye[0] - camera.position.x) * clamp(dt * 10, 0, 1)
    camera.position.y += (eye[1] - camera.position.y) * clamp(dt * 12, 0, 1)
    camera.position.z += (eye[2] - camera.position.z) * clamp(dt * 10, 0, 1)
  // Use YXZ rotation order: yaw (Y) then pitch (X) then roll (Z)
  camera.rotation.order = 'YXZ'
  const smoothFactor = clamp(dt * 12, 0, 1)
  // apply yaw to Y and pitch to X
  camera.rotation.y += (me.yaw - camera.rotation.y) * smoothFactor
  camera.rotation.x += (me.pitch - camera.rotation.x) * smoothFactor
    const speed = Math.hypot(me.vel[0], me.vel[2])
    const targetFov = clamp(80 + (speed - 5) * 2.0, 80, 98)
  camAny.fov += (targetFov - camAny.fov) * clamp(dt * 4, 0, 1)
  camAny.updateProjectionMatrix()
    // roll for wallrun and sway based on lateral velocity
    let targetRoll = 0
    if (me.mode === 'wallrunL') targetRoll = 0.22
    if (me.mode === 'wallrunR') targetRoll = -0.22
    // add sway based on lateral velocity
    const lateral = me.vel[0]
    targetRoll += clamp(-lateral * 0.02, -0.12, 0.12)
    rollRef.current += (targetRoll - rollRef.current) * clamp(dt * 8, 0, 1)
    camera.rotation.z = rollRef.current

    // bob: vertical oscillation while moving
    bobRef.current += dt * (1 + speed * 0.3)
    const bobAmt = Math.sin(bobRef.current * 8) * clamp(speed * 0.01, 0, 0.04)
    camera.position.y += bobAmt
  })
  return null
}

// GhostTrails removed
