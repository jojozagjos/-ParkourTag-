import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { getSettings, setSettings, subscribe, resetSettings } from '../state/settings'
import { Canvas, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import constants from '../../../shared/constants.json'
import faceTexturePath from '../../assets/textures/face.png'

export default function Menu({ socket }: { socket: Socket }) {
  const [name, setName] = useState('Runner')
  const [joinCode, setJoinCode] = useState('')
  const [color, setColor] = useState('#f0b46d')
  const [face, setFace] = useState<'smile'>('smile')
  const [hat, setHat] = useState<'none' | 'cap' | 'cone' | 'halo'>('none')
  const [faceData, setFaceData] = useState<string | null>(null)
  const [screen, setScreen] = useState<'home' | 'customize' | 'settings'>('home')
  useEffect(() => {
    try {
      const n = localStorage.getItem('playerName')
      if (n && typeof n === 'string') setName(n.slice(0,24))
      const s = localStorage.getItem('playerColor')
      if (s) setColor(s)
  const f = localStorage.getItem('playerFace')
  if (f === 'smile') setFace('smile')
      const h = localStorage.getItem('playerHat')
      if (h === 'none' || h === 'cap' || h === 'cone' || h === 'halo') setHat(h)
      const fd = localStorage.getItem('playerFaceData')
      if (fd && fd.startsWith('data:image/png')) setFaceData(fd)
    } catch {}
  }, [])

  function saveName(v: string) {
    const trimmed = v.slice(0, 24)
    setName(trimmed)
    try { localStorage.setItem('playerName', trimmed) } catch {}
    // If connected to a room, server will accept this; otherwise it's ignored harmlessly
    socket.emit('player:update', { name: trimmed })
  }

  function host() { socket.emit('room:create', { name }); socket.emit('player:update', { name, color, face, hat, faceData }) }
  function join() { if (joinCode) { socket.emit('room:join', { code: joinCode.toUpperCase(), name }); socket.emit('player:update', { name, color, face, hat, faceData }) } }
  function saveColor(c: string) {
    setColor(c)
    try { localStorage.setItem('playerColor', c) } catch {}
    socket.emit('player:update', { color: c })
  }
  function resetColor() {
    const def = '#f0b46d'
    setColor(def)
    try { localStorage.setItem('playerColor', def) } catch {}
    socket.emit('player:update', { color: def })
  }
  function saveFace(v: 'smile') {
    setFace(v)
    try { localStorage.setItem('playerFace', v) } catch {}
    socket.emit('player:update', { face: v })
  }
  function saveHat(v: 'none' | 'cap' | 'cone' | 'halo') {
    setHat(v)
    try { localStorage.setItem('playerHat', v) } catch {}
    socket.emit('player:update', { hat: v })
  }
  function saveFaceDataUrl(dataUrl: string | null) {
    setFaceData(dataUrl)
    try {
      if (dataUrl) localStorage.setItem('playerFaceData', dataUrl)
      else localStorage.removeItem('playerFaceData')
    } catch {}
    socket.emit('player:update', { faceData: dataUrl })
  }

  return (
  <div className="app-menu-layout">
      <div className="bg-decor" />
      {/* Left vertical navigation */}
      <aside className="menu-nav" aria-label="Main navigation">
        <div className="brand">
          <h1 className="logo">Parkour Tag</h1>
        </div>
        <ul className="nav-list">
          <li className={screen==='home' ? 'active' : ''}><button onClick={() => setScreen('home')}>Play</button></li>
          <li className={screen==='customize' ? 'active' : ''}><button onClick={() => setScreen('customize')}>Customize</button></li>
          <li className={screen==='settings' ? 'active' : ''}><button onClick={() => setScreen('settings')}>Settings</button></li>
        </ul>
        <div className="nav-footer">
          <div className="version">v0.1</div>
        </div>
      </aside>

      {/* Main content area */}
      <main className="menu-content">
        <div className="hero-overlay" />
        {screen === 'home' && (
          <section className="panel section-panel">
            <h2 className="section-title">Play</h2>
            <div className="section-body">
              <div className="field-group">
                <label htmlFor="displayName">Display Name</label>
                <input id="displayName" value={name} onChange={e => saveName(e.target.value)} placeholder="Your name" maxLength={24} />
              </div>
              <div className="actions" style={{ marginTop: 6, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <button onClick={host} title="Create a new lobby">Host</button>
                <button onClick={join} className="secondary" title="Join existing lobby" disabled={!joinCode || joinCode.trim().length < 3}>Join</button>
                <input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Room code" maxLength={5} style={{ width: 110, textTransform:'uppercase' }} />
              </div>
              <div className="helper">Host to generate a 5‑char code and share with friends.<br />Movement: WASD + Space + Shift + C (slide). Esc: pause/settings.</div>
            </div>
          </section>
        )}

        {screen === 'customize' && (
          <section className="panel section-panel customize-panel">
            <h2 className="section-title">Customize Runner</h2>
            <div className="customize-grid">
              <div className="customize-form">
                <div className="field-group">
                  <label>Body Color</label>
                  <div className="color-row">
                    <input aria-label="Body color" type="color" value={color} onChange={e => saveColor(e.target.value)} />
                    <span className="color-code">{color}</span>
                    <button className="secondary" onClick={resetColor}>Reset</button>
                  </div>
                </div>
                <div className="field-group">
                  <label>Face</label>
                  <div className="helper">Draw your own face below. Leave empty to use the default smile.</div>
                  <FacePainter initial={faceData} onChange={saveFaceDataUrl} bodyColor={color} />
                </div>
                <div className="field-group">
                  <label>Accessory</label>
                  <select value={hat} onChange={e => saveHat(e.target.value as any)}>
                    <option value="none">None</option>
                    <option value="cap">Cap</option>
                    <option value="cone">Cone</option>
                    <option value="halo">Halo</option>
                  </select>
                </div>
                <div className="helper">Changes apply immediately and will appear for other players after joining.</div>
              </div>
              <div className="preview-wrap">
                <AvatarPreview color={color} face={face} hat={hat} faceData={faceData} />
                <div style={{ position:'absolute', bottom:10, right:14, fontSize:'0.7rem', letterSpacing:'0.08em', opacity:0.6, pointerEvents:'none', textTransform:'uppercase' }}>Click & Drag to Rotate</div>
              </div>
            </div>
          </section>
        )}

        {screen === 'settings' && (
          <section className="panel section-panel">
            <h2 className="section-title">Settings</h2>
            <MenuSettings />
          </section>
        )}
      </main>

      {/* No right-side artwork: content uses remaining space */}
    </div>
  )
}

function MenuSettings() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const on = () => setTick(t => t + 1)
    const unsub = subscribe(on)
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

function AvatarPreview({ color, face, hat, faceData }: { color: string, face: 'smile', hat: 'none' | 'cap' | 'cone' | 'halo', faceData: string | null }) {
  return (
    <Canvas style={{ width:'100%', height:'100%' }} camera={{ position:[2.1, 1.6, 2.6], fov: 50 }} shadows dpr={Math.min(window.devicePixelRatio||1, 1.5)}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3,4,2]} intensity={1.2} castShadow shadow-mapSize={[1024,1024]} />
      <PreviewContent color={color} face={face} hat={hat} faceData={faceData} />
    </Canvas>
  )
}

function PreviewContent({ color, face, hat, faceData }: { color: string, face: 'smile', hat: 'none' | 'cap' | 'cone' | 'halo', faceData: string | null }) {
  const faceTexture = useLoader(THREE.TextureLoader, faceTexturePath)
  const group = useRef<THREE.Group>(null)
  const lastDragX = useRef<number | null>(null)

  function onPointerDown(e: any) {
    lastDragX.current = e.clientX
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId as any)
  }
  function onPointerUp(e: any) {
    lastDragX.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId as any) } catch {}
  }
  function onPointerMove(e: any) {
    if (lastDragX.current == null || !group.current) return
    const dx = e.clientX - lastDragX.current
    lastDragX.current = e.clientX
    group.current.rotation.y += dx * 0.005
  }
  const H = constants.PLAYER?.HEIGHT ?? 1.8
  const EYE = constants.PLAYER?.EYE_HEIGHT ?? 1.62
  const faceTex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256; c.height = 256
    const ctx = c.getContext('2d')!
    if (faceData && faceData.startsWith('data:image/png')) {
      // Custom face only (no base) when user provided data
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        ctx.clearRect(0, 0, c.width, c.height)
        ctx.drawImage(img, 0, 0, c.width, c.height)
        // Mark texture updated after async draw
        tx.needsUpdate = true
      }
      img.src = faceData
    } else {
      // Default: draw only base face image (no smile overlay)
      try { ctx.drawImage((faceTexture as any).image, 0, 0, c.width, c.height) } catch {}
    }
    const tx = new THREE.CanvasTexture(c)
    tx.colorSpace = THREE.SRGBColorSpace
    tx.minFilter = THREE.LinearFilter
    tx.magFilter = THREE.LinearFilter
    tx.needsUpdate = true
    return tx
  }, [faceTexture, faceData])

  const bodyColor = useMemo(() => new THREE.Color(/^#/.test(color)? color : '#f0b46d'), [color])

  return (
    <group ref={group} position={[0,-0.55,0]} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onPointerMove={onPointerMove}>
      <mesh position={[0, H/2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.7, H, 0.7]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>
      <mesh position={[0, EYE - 0.17, -0.36]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.7, 0.7]} />
        <meshBasicMaterial map={faceTex} transparent side={THREE.DoubleSide} />
      </mesh>
      {hat !== 'none' && (
        hat === 'cap' ? (
          <group>
            <mesh position={[0, EYE + 0.07, 0]} castShadow>
              <sphereGeometry args={[0.38, 16, 12]} />
              <meshStandardMaterial color="#222a3d" roughness={0.6} metalness={0.2} />
            </mesh>
            <mesh position={[0, EYE - 0.01, -0.22]} rotation={[Math.PI/2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.06, 0.12, 0.35, 12]} />
              <meshStandardMaterial color="#222a3d" roughness={0.6} metalness={0.2} />
            </mesh>
          </group>
        ) : hat === 'cone' ? (
          <mesh position={[0, EYE + 0.2, 0]} castShadow>
            <coneGeometry args={[0.32, 0.7, 16]} />
            <meshStandardMaterial color="#ffb347" roughness={0.5} metalness={0.1} />
          </mesh>
        ) : (
          <mesh position={[0, EYE + 0.28, 0]} rotation={[Math.PI/2,0,0]}>
            <torusGeometry args={[0.42, 0.07, 16, 32]} />
            <meshStandardMaterial color="#ffe066" emissive="#ffea8a" emissiveIntensity={0.8} metalness={0.3} roughness={0.2} />
          </mesh>
        )
      )}
      <mesh position={[0,-0.01,0]} rotation={[-Math.PI/2,0,0]} receiveShadow>
        <circleGeometry args={[3, 32]} />
        <meshStandardMaterial color="#0a0f1a" />
      </mesh>
    </group>
  )
}

function FacePainter({ initial, onChange, bodyColor }: { initial: string | null, onChange: (dataUrl: string | null) => void, bodyColor?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isErasing, setIsErasing] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [brush, setBrush] = useState(10)
  const [color, setColor] = useState<string>('#ffffff')
  const bodyBg = bodyColor || '#222'

  useEffect(() => {
    const cnv = canvasRef.current
    if (!cnv) return
    const ctx = cnv.getContext('2d')!
    ctx.clearRect(0, 0, cnv.width, cnv.height)
    // Load initial user art if provided
    if (initial && initial.startsWith('data:image/png')) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, cnv.width, cnv.height)
      img.src = initial
    }
  }, [initial])

  function pointer(e: React.PointerEvent<HTMLCanvasElement>) {
    const cnv = canvasRef.current!
    const rect = cnv.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * cnv.width
    const y = ((e.clientY - rect.top) / rect.height) * cnv.height
    return { x, y }
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrawing(true)
    draw(e, true)
  }
  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    setDrawing(false)
    // Save after stroke ends (only if non-empty)
    const cnv = canvasRef.current!
    const ctx = cnv.getContext('2d')!
    const img = ctx.getImageData(0, 0, cnv.width, cnv.height)
    // Count non-transparent pixels to enforce a minimum draw threshold
    let count = 0
    for (let i = 3; i < img.data.length; i += 4) { if (img.data[i] !== 0) count++ }
    const MIN_PIXELS = Math.floor(256 * 256 * 0.02) // ~2% coverage
    if (count >= MIN_PIXELS) {
      const url = cnv.toDataURL('image/png')
      onChange(url)
    } else {
      onChange(null)
    }
    last.current = null
  }
  const last = useRef<{x:number,y:number}|null>(null)
  function draw(e: React.PointerEvent<HTMLCanvasElement>, start = false) {
    if (!drawing && !start) return
    const { x, y } = pointer(e)
    const cnv = canvasRef.current!
    const ctx = cnv.getContext('2d')!
    if (isErasing) {
      // Erase a small circular area under the cursor instead of long paths
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(x, y, brush * 0.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      last.current = { x, y }
      return
    }
    // Drawing
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = brush
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = color
    if (start || !last.current) {
      last.current = { x, y }
      ctx.beginPath(); ctx.moveTo(x, y)
    } else {
      ctx.beginPath()
      ctx.moveTo(last.current.x, last.current.y)
      ctx.lineTo(x, y)
      ctx.stroke()
      last.current = { x, y }
    }
  }

  function clearAll() {
    const cnv = canvasRef.current!
    const ctx = cnv.getContext('2d')!
    ctx.clearRect(0, 0, cnv.width, cnv.height)
    onChange(null)
  }

  return (
    <div className="face-painter" style={{ display:'grid', gap:8, position:'relative', zIndex:1 }}>
      <canvas
        ref={canvasRef}
        width={256}
        height={256}
  style={{ width: 256, height: 256, border:'1px solid #334', background: bodyBg }}
        onPointerDown={onDown}
        onPointerMove={draw}
        onPointerUp={onUp}
        // do not finalize on leave; pointer capture keeps events flowing
      />
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <button onClick={() => setIsErasing(false)} className={!isErasing ? 'active' : ''}>Draw</button>
        <button onClick={() => setIsErasing(true)} className={isErasing ? 'active' : ''}>Erase</button>
        <label style={{ marginLeft:8 }}>Brush</label>
        <input type="range" min={3} max={24} value={brush} onChange={e => setBrush(Number(e.target.value))} />
        <label style={{ marginLeft:8 }}>Stroke</label>
        <input type="color" value={color} onChange={e => setColor(e.target.value)} />
        <button className="secondary" onClick={clearAll}>Clear</button>
      </div>
    </div>
  )
}

// removed colorizeBg helper; background tied to body color now
