import React, { useState } from 'react'
import type { Socket } from 'socket.io-client'

export default function Menu({ socket }: { socket: Socket }) {
  const [name, setName] = useState('Runner')
  const [joinCode, setJoinCode] = useState('')

  function host() { socket.emit('room:create', { name }) }
  function join() { if (joinCode) socket.emit('room:join', { code: joinCode.toUpperCase(), name }) }

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <div className="panel">
        <h1 style={{ marginTop: 0 }}>Parkour Tag</h1>
        <label style={{ display: 'block', marginBottom: 8 }}>Display name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder='Your name' style={{ width: '100%', marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={host}>Host</button>
          <input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder='Room code' style={{ flex: 1 }} />
          <button onClick={join}>Join</button>
        </div>
        <p style={{ opacity: 0.85, marginTop: 12 }}>Host creates a room. Others enter the code to join.</p>
      </div>
    </div>
  )
}
