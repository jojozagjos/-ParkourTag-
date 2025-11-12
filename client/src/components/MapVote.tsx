import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'

export default function MapVote({ socket, maps, current, voteCounts }:{ socket: Socket, maps: string[], current: string, voteCounts?: Record<string, number> }) {
  const opts = useMemo(() => maps, [maps])
  const [highlight, setHighlight] = useState(0)
  const userChangedRef = useRef(false)
  // Only initialize highlight once or if current option disappears
  useEffect(() => {
    if (!opts.length) return
    const curIdx = opts.indexOf(current)
    // If current isn't in list or highlight is out of bounds, correct it.
    if (highlight >= opts.length || highlight < 0) {
      setHighlight(curIdx >= 0 ? curIdx : 0)
      return
    }
    // If the user hasn't manually changed and current exists, set initial highlight.
    if (!userChangedRef.current && curIdx >= 0) {
      setHighlight(curIdx)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts])

  useEffect(() => {
    // Auto-unlock pointer while voting
    try {
      if (document.pointerLockElement) document.exitPointerLock()
    } catch {}
    function onKey(e: KeyboardEvent) {
      // 1..9 vote directly
      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1
        if (idx >= 0 && idx < opts.length) socket.emit('vote:map', { name: opts[idx] })
      }
      // arrows to move highlight, Enter to vote highlighted
  if (e.key === 'ArrowRight' || e.key === 'd') { userChangedRef.current = true; setHighlight(h => Math.min(opts.length - 1, h + 1)) }
  if (e.key === 'ArrowLeft' || e.key === 'a') { userChangedRef.current = true; setHighlight(h => Math.max(0, h - 1)) }
  if (e.key === 'ArrowDown' || e.key === 's') { userChangedRef.current = true; setHighlight(h => Math.min(opts.length - 1, h + 2)) }
  if (e.key === 'ArrowUp' || e.key === 'w') { userChangedRef.current = true; setHighlight(h => Math.max(0, h - 2)) }
      if (e.key === 'Enter' || e.key === ' ') {
        const m = opts[highlight]
        if (m) socket.emit('vote:map', { name: m })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opts, highlight, socket])

  if (!opts?.length) return null
  const leading = useMemo(() => {
    if (!voteCounts) return null
    let best = null as string | null, bestCount = -1
    for (const m of Object.keys(voteCounts)) {
      const c = voteCounts[m] || 0
      if (c > bestCount) { bestCount = c; best = m }
    }
    return best
  }, [voteCounts])

  return (
    <div style={{
      position:'fixed', inset:0,
      background:'rgba(4,8,20,0.65)', display:'flex', alignItems:'center', justifyContent:'center',
      backdropFilter:'blur(6px)', zIndex: 900
    }}>
      <div style={{ maxWidth:900, width:'92%', padding:'20px 22px', borderRadius:14, background:'rgba(10,16,36,0.75)', border:'1px solid #2a365e', boxShadow:'0 8px 24px rgba(0,0,0,0.45)'}}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14 }}>
          <h2 style={{ margin:0 }}>Vote next map</h2>
          <div style={{ opacity:0.8, fontSize:13 }}>Press 1–9 or use arrows + Enter</div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {opts.map((m, i) => {
            const count = voteCounts?.[m] || 0
            const isCurrent = m === current
            const isLeading = leading === m && count > 0
            const isHi = i === highlight
            return (
              <button key={m} onClick={() => { userChangedRef.current = true; setHighlight(i); socket.emit('vote:map', { name:m }) }}
                style={{
                  padding:'14px 16px', borderRadius:10, border:'1px solid #30407a', cursor:'pointer', textAlign:'left',
                  background: isHi ? '#1b2a5a' : (isCurrent ? '#122046' : '#0d1430'), color:'#fff',
                  position:'relative', minHeight:72,
                  outline: isHi ? '2px solid #3c5cff' : 'none'
                }}
                aria-label={`Vote ${m}`}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ fontSize:16, fontWeight:600 }}>{m}</div>
                  <div style={{ opacity:0.8, fontSize:12 }}>[{i+1}]</div>
                </div>
                {count > 0 && <div style={{ position:'absolute', top:8, right:8, background:'#203c7a', padding:'2px 8px', borderRadius:12, fontSize:12 }}>{count}</div>}
                {isLeading && <div style={{ position:'absolute', inset:0, borderRadius:10, boxShadow:'0 0 0 2px #3c5cff inset', pointerEvents:'none' }} />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
