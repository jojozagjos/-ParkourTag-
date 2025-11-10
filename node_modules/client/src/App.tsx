/// <reference types="vite/client" />
import React, { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import Menu from './components/Menu'
import Lobby from './components/Lobby'
import Game from './components/Game'

type Screen = 'menu' | 'lobby' | 'game'

export type PlayerSummary = { id: string, name: string, ready: boolean, host: boolean }

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [socket, setSocket] = useState<Socket | null>(null)
  const [roomCode, setRoomCode] = useState<string>('')
  const [players, setPlayers] = useState<PlayerSummary[]>([])
  const [selfId, setSelfId] = useState<string>('')

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
    s.on('lobby:update', (payload: { roomCode: string, players: PlayerSummary[] }) => {
      setRoomCode(payload.roomCode)
      setPlayers(payload.players)
      setScreen('lobby')
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
      {screen === 'menu' && <Menu socket={socket} />}
      {screen === 'lobby' && (
        <Lobby socket={socket} roomCode={roomCode} players={players} selfId={selfId} />
      )}
      {screen === 'game' && <Game socket={socket} selfId={selfId} />}
    </div>
  )
}
