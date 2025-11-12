import React from 'react'
import type { RoundResults } from '../types'
import type { Socket } from 'socket.io-client'
import MapVote from './MapVote'

export default function ResultsModal({ results, onDismiss, socket, maps, current, voteCounts }:{ results: RoundResults | null, onDismiss?: () => void, socket?: Socket, maps?: string[], current?: string, voteCounts?: Record<string, number> }) {
  if (!results) return null
  return (
    <div style={{
      position:'fixed', inset:0, display:'grid', placeItems:'center',
      background:'rgba(0,0,0,0.5)', zIndex: 1000
    }}>
      <div style={{ background:'#0b1128', padding:24, borderRadius:12, width:'min(920px, 96vw)' }}>
        <h3 style={{ marginTop:0 }}>Round Results</h3>
        <ol>
          {results.placement.map(p => (
            <li key={p.id} style={{ display:'flex', justifyContent:'space-between' }}>
              <span>{p.name}</span><span>{p.score}</span>
            </li>
          ))}
        </ol>
        <p style={{ opacity:0.8, marginBottom:12 }}>Intermission. Vote for the next map.</p>
        {/* Inline voting block (only if we have maps and a socket) */}
        {socket && Array.isArray(maps) && maps.length > 0 && current && (
          <div style={{ marginTop:12 }}>
            <MapVote inline socket={socket} maps={maps} current={current} voteCounts={voteCounts} />
          </div>
        )}
        <div style={{ marginTop:12 }}>
          {onDismiss && <button onClick={onDismiss}>Continue</button>}
        </div>
      </div>
    </div>
  )
}
