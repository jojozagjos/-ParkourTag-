import React, { useMemo } from 'react'
import type { Socket } from 'socket.io-client'

export default function MapVote({ socket, maps, current }:{ socket: Socket, maps: string[], current: string }) {
  const opts = useMemo(() => maps, [maps])
  if (!opts?.length) return null
  return (
    <div style={{
      position:'fixed', bottom:12, left:'50%', transform:'translateX(-50%)',
      background:'rgba(0,0,0,0.35)', padding:'10px 12px', borderRadius:10, display:'flex', gap:10
    }}>
      <span style={{ opacity:0.8, marginRight:6 }}>Vote next map:</span>
      {opts.map(m => (
        <button key={m} onClick={() => socket.emit('vote:map', { name:m })}
          style={{ padding:'8px 10px', borderRadius:8, border:'1px solid #30407a', background: m===current ? '#1b2a5a' : '#0d1430', color:'#fff' }}>
          {m}
        </button>
      ))}
    </div>
  )
}
