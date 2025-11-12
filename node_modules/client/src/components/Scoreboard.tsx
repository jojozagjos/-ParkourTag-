import React, { useMemo } from 'react'
import type { Scores, NetPlayer } from '../types'
import { lookupName } from '../nameRegistry'

export default function Scoreboard({ scores, itId, players }:{ scores: Scores, itId: string | null, players: NetPlayer[] }) {
  const nameOf = useMemo(() => {
    const m = new Map<string,string>()
    for (const p of players) if (p.name) m.set(p.id, p.name)
    return (id: string) => {
      const direct = m.get(id)
      if (direct && direct.trim()) return direct
      const cached = lookupName(id)
      if (cached && cached.trim()) return cached
      return id.slice(0,4)
    }
  }, [players])

  const items = useMemo(() => Object.entries(scores).sort((a,b) => (b[1] - a[1])), [scores])
  return (
    <div style={{ position:'fixed', top:12, right:12, background:'rgba(0,0,0,0.35)', padding:'8px 12px', borderRadius:8, minWidth:200 }}>
      <div style={{ opacity:0.8, marginBottom:6 }}>Scoreboard</div>
      {items.map(([id, sc]) => (
        <div key={id} style={{ display:'flex', justifyContent:'space-between', gap:12 }}>
          <span>{id === itId ? 'IT: ' : ''}{nameOf(id)}</span>
          <span>{Math.round(sc)}</span>
        </div>
      ))}
    </div>
  )
}
