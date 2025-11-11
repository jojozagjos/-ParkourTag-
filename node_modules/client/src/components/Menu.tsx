import React, { useState } from 'react'
import type { Socket } from 'socket.io-client'

export default function Menu({ socket }: { socket: Socket }) {
  const [name, setName] = useState('Runner')
  const [joinCode, setJoinCode] = useState('')

  function host() { socket.emit('room:create', { name }) }
  function join() { if (joinCode) socket.emit('room:join', { code: joinCode.toUpperCase(), name }) }

  return (
    <div className="menu-root">
      <div className="bg-decor" />
      <div className="panel">
        <h1>Parkour Tag</h1>
        <div className="subtitle">Fast-paced wallruns &amp; chase. Host or join a lobby.</div>
        <div style={{ marginBottom: 18 }}>
          <label htmlFor="displayName">Display Name</label>
          <input id="displayName" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="actions" style={{ marginBottom: 6 }}>
          <button onClick={host} title="Create a new lobby">Host</button>
          <input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Room code" maxLength={5} />
          <button onClick={join} className="secondary" title="Join existing lobby">Join</button>
        </div>
        <div className="helper">Host to generate a 5‑character code. Give it to friends so they can join.<br />Use WASD + Space + Shift in game.</div>
        <div className="footer-hint">v0.1 • Experimental movement playground</div>
      </div>
    </div>
  )
}
