import type { Snapshot, NetPlayer } from './types'

type Buffered = { t: number, snap: Snapshot }
const BUFFER_MS = 100  // interpolation delay

export class SnapshotBuffer {
  private buf: Buffered[] = []
  push(snap: Snapshot) {
    this.buf.push({ t: performance.now(), snap })
    if (this.buf.length > 10) this.buf.shift()
  }
  // Returns interpolated snapshot at now - BUFFER_MS
  sample(): Snapshot | null {
    if (this.buf.length < 2) return this.buf[this.buf.length - 1]?.snap || null
    const target = performance.now() - BUFFER_MS
    let i = 0
    while (i + 1 < this.buf.length && this.buf[i + 1].t < target) i++
    const a = this.buf[i], b = this.buf[i + 1] || a
    const span = Math.max(1, b.t - a.t)
    const f = Math.min(1, Math.max(0, (target - a.t) / span))
    function lerp(a: number, b: number) { return a + (b - a) * f }
    function lerp3(pa: number[], pb: number[]) { return [lerp(pa[0], pb[0]), lerp(pa[1], pb[1]), lerp(pa[2], pb[2])] as [number,number,number] }
    const players: NetPlayer[] = []
    for (const pA of a.snap.players) {
      const pB = b.snap.players.find(x => x.id === pA.id) || pA
      players.push({
        ...pA,
        pos: lerp3(pA.pos as any, pB.pos as any),
        vel: lerp3(pA.vel as any, pB.vel as any),
        yaw: lerp(pA.yaw, pB.yaw),
        pitch: lerp(pA.pitch, pB.pitch),
        mode: pB.mode
      })
    }
    return { ...b.snap, players }
  }
}
