import React from 'react'
import type { Scores } from '../types'

export default function Scoreboard({ scores, itId }:{ scores: Scores, itId: string | null }) {
  const items = Object.entries(scores).sort((a,b) => (b[1] - a[1]))
  return (
    <div style={{ position:'fixed', top:12, right:12, background:'rgba(0,0,0,0.35)', padding:'8px 12px', borderRadius:8, minWidth:160 }}>
      <div style={{ opacity:0.8, marginBottom:6 }}>Scoreboard</div>
      {items.map(([id, sc]) => (
        <div key={id} style={{ display:'flex', justifyContent:'space-between', gap:12 }}>
          <span>{id === itId ? 'IT' : 'P'}:{id.slice(0,4)}</span>
          <span>{Math.round(sc)}</span>
        </div>
      ))}
    </div>
  )
}
