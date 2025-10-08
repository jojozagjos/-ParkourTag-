import React from 'react'
import type { RoundResults } from '../types'

export default function ResultsModal({ results }:{ results: RoundResults | null }) {
  if (!results) return null
  return (
    <div style={{
      position:'fixed', inset:0, display:'grid', placeItems:'center',
      background:'rgba(0,0,0,0.5)'
    }}>
      <div style={{ background:'#0b1128', padding:24, borderRadius:12, width:360 }}>
        <h3 style={{ marginTop:0 }}>Round Results</h3>
        <ol>
          {results.placement.map(p => (
            <li key={p.id} style={{ display:'flex', justifyContent:'space-between' }}>
              <span>{p.name}</span><span>{p.score}</span>
            </li>
          ))}
        </ol>
        <p style={{ opacity:0.8 }}>Intermission. Next map loading soon.</p>
      </div>
    </div>
  )
}
