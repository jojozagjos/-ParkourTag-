/// <reference types="vite/client" />
import React, { useEffect, useState } from 'react'
import './styles.css'
import { io, Socket } from 'socket.io-client'
import Menu from './components/Menu'
import Lobby from './components/Lobby'
import Game from './components/Game'

type Screen = 'intro' | 'menu' | 'lobby' | 'game'

export type PlayerSummary = { id: string, name: string, ready: boolean, host: boolean }

export default function App() {
  const [screen, setScreen] = useState<Screen>('intro')
  const [socket, setSocket] = useState<Socket | null>(null)
  const [roomCode, setRoomCode] = useState<string>('')
  const [players, setPlayers] = useState<PlayerSummary[]>([])
  const [selfId, setSelfId] = useState<string>('')
  const [maps, setMaps] = useState<string[]>([])
  const [mapName, setMapName] = useState<string>('')
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({})
  const [gameMode, setGameMode] = useState<'default' | 'noAbility' | 'dark'>('default')

  useEffect(() => {
    // Use same-origin in production; allow override during local dev via VITE_SERVER_URL
    const defaultUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
    const url = (import.meta as any).env?.VITE_SERVER_URL || defaultUrl
  // Don't force websocket-only transport; allow polling fallback. This avoids
  // "WebSocket is closed before the connection is established" errors when
  // a websocket upgrade is not available locally (proxies, env, etc.).
  const s = io(url, { reconnectionAttempts: Infinity, reconnectionDelay: 1000 })
    setSocket(s)
  s.on('connect', () => setSelfId(s.id ?? ''))
  s.on('connect_error', (err) => console.warn('socket connect_error', err && (err.message || err)))
    s.on('lobby:update', (payload: { roomCode: string, players: PlayerSummary[], maps?: string[], mapName?: string, gameMode?: string }) => {
      setRoomCode(payload.roomCode)
      setPlayers(payload.players)
      if (payload.maps) setMaps(payload.maps)
      if (payload.mapName) setMapName(payload.mapName)
      if (payload.gameMode === 'default' || payload.gameMode === 'noAbility' || payload.gameMode === 'dark') setGameMode(payload.gameMode)
      setScreen('lobby')
    })
    s.on('vote:update', (payload: { votes: Record<string,string> }) => {
      // Tally counts
      const tally: Record<string, number> = {}
      for (const v of Object.values(payload.votes)) {
        if (!v) continue
        tally[v] = (tally[v] || 0) + 1
      }
      setVoteCounts(tally)
    })
    s.on('game:started', () => setScreen('game'))
    s.on('disconnect', () => {
      setScreen('menu'); setPlayers([]); setRoomCode('')
    })
    return () => { s.disconnect(); }
  }, [])

  if (!socket) return <div style={{ padding: 16 }}>Connecting…</div>

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      {screen === 'intro' && <Intro onDone={() => setScreen('menu')} />}
      {screen === 'menu' && <Menu socket={socket} />}
      {screen === 'lobby' && (
        <Lobby socket={socket} roomCode={roomCode} players={players} selfId={selfId} maps={maps} mapName={mapName} voteCounts={voteCounts} gameMode={gameMode} />
      )}
      {screen === 'game' && <Game socket={socket} selfId={selfId} />}
    </div>
  )
}

function Intro({ onDone }: { onDone: () => void }) {
  // stages: 0 (creator), 1 (title reveal), 2 (hold), 3 (done)
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0)

  useEffect(() => {
    const t1 = window.setTimeout(() => setStage(1), 1800) // switch to title reveal
    const t2 = window.setTimeout(() => setStage(2), 4200) // hold finished title
    const t3 = window.setTimeout(() => { setStage(3); onDone() }, 5600)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [onDone])

  useEffect(() => {
    function skip() { setStage(3); onDone() }
    window.addEventListener('keydown', skip)
    window.addEventListener('mousedown', skip)
    return () => { window.removeEventListener('keydown', skip); window.removeEventListener('mousedown', skip) }
  }, [onDone])

  const title = 'PARKOUR TAG'
  return (
    <div className="intro-root">
      {/* Creator credit */}
      <div className={`intro-credit ${stage === 0 ? 'show' : 'hide'}`}>made by joseph slade</div>
      {/* Title sequence */}
      <div className={`intro-title ${stage >= 1 ? 'show' : 'hide'} ${stage === 2 ? 'solid' : ''}`}> 
        {title.split('').map((ch, i) => (
          <span key={i} style={{ animationDelay: `${0.05 * i}s` }} className="intro-letter">{ch}</span>
        ))}
      </div>
      <div className="intro-skip">Press any key or click to skip</div>
      <div className="intro-hit" aria-hidden />
    </div>
  )
}
