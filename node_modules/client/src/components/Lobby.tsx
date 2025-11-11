import React from 'react'
import type { Socket } from 'socket.io-client'
import type { PlayerSummary } from '../App'

export default function Lobby({ socket, roomCode, players, selfId }: { socket: Socket, roomCode: string, players: PlayerSummary[], selfId: string }) {
  const me = players.find(p => p.id === selfId)
  const isHost = !!me?.host
  const readyCount = players.filter(p => p.ready).length

  function toggleReady() { socket.emit('lobby:ready', { ready: !me?.ready }) }
  function startGame() { socket.emit('game:start') }
  async function copyCode() {
    try { await navigator.clipboard.writeText(roomCode) } catch {}
  }

  return (
    <div className="menu-root">
      <div className="panel lobby-panel">
        <div className="lobby-header">
          <div>
            <h1 style={{ margin: 0 }}>Lobby</h1>
            <div className="subtitle">Invite friends with the code, ready up, and the host can start.</div>
          </div>
          <div className="room-badge" title="Click to copy" onClick={copyCode} role="button" aria-label="Copy room code">
            <span className="label">Room</span>
            <span className="code">{roomCode || '-----'}</span>
          </div>
        </div>

        <div className="lobby-body">
          <div className="players-card">
            <div className="card-title">Players <span className="muted">({players.length})</span></div>
            <ul className="player-list">
              {players.map(p => (
                <li key={p.id} className="player-row">
                  <div className="who">
                    <span className="name">{p.name}</span>
                    {p.host && <span className="badge badge-host">Host</span>}
                    {p.id === selfId && <span className="badge badge-self">You</span>}
                  </div>
                  <div className={`status ${p.ready ? 'ready' : 'waiting'}`}>{p.ready ? 'Ready' : 'Waiting'}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="actions-card">
            <div className="card-title">Actions</div>
            <div className="actions">
              <button onClick={toggleReady}>{me?.ready ? 'Unready' : 'Ready'}</button>
              {isHost && <button onClick={startGame} className="secondary">Start</button>}
            </div>
            <div className="helper" style={{ marginTop: 12 }}>
              Ready: {readyCount}/{players.length}. The server enforces minimum players; start will fail if not enough.
            </div>
            <div className="footer-hint">Map voting appears during intermission between rounds.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
