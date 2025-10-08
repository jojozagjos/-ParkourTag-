import React from 'react'
import type { Socket } from 'socket.io-client'
import type { PlayerSummary } from '../App'

export default function Lobby({ socket, roomCode, players, selfId }: { socket: Socket, roomCode: string, players: PlayerSummary[], selfId: string }) {
  const me = players.find(p => p.id === selfId)
  const isHost = me?.host

  function toggleReady() { socket.emit('lobby:ready', { ready: !me?.ready }) }
  function startGame() { socket.emit('game:start') }

  return (
    <div style={{ padding: 24 }}>
      <h2>Room {roomCode}</h2>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div>
          <h3>Players</h3>
          <ul>
            {players.map(p => (
              <li key={p.id}>{p.name} {p.host ? '(host)' : ''} {p.ready ? '✅' : '⏳'} {p.id === selfId ? '← you' : ''}</li>
            ))}
          </ul>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={toggleReady}>{me?.ready ? 'Unready' : 'Ready'}</button>
          {isHost && <button onClick={startGame}>Start</button>}
        </div>
      </div>
      <p style={{ marginTop: 16 }}>All players ready up. Host can start.</p>
      <p style={{ opacity:0.8 }}>Map voting will appear during intermission.</p>
    </div>
  )
}
