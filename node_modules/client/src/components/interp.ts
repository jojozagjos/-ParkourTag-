import type { Snapshot, NetPlayer } from '../types'

type Buffered = { t: number, snap: Snapshot }
const BUFFER_MS = 70

function lerp(a: number, b: number, f: number) { return a + (b - a) * f }
function lerpAngle(a: number, b: number, f: number) {
	let diff = b - a
	while (diff > Math.PI) diff -= Math.PI * 2
	while (diff < -Math.PI) diff += Math.PI * 2
	return a + diff * f
}

export class SnapshotBuffer {
	private buf: Buffered[] = []
	push(snap: Snapshot) {
		this.buf.push({ t: performance.now(), snap })
		if (this.buf.length > 20) this.buf.shift()
	}
	sample(): Snapshot | null {
		if (this.buf.length < 2) return this.buf[this.buf.length - 1]?.snap || null
		const target = performance.now() - BUFFER_MS
		let i = 0
		while (i + 1 < this.buf.length && this.buf[i + 1].t < target) i++
		const a = this.buf[i], b = this.buf[i + 1] || a
		const span = Math.max(1, b.t - a.t)
		const f = Math.min(1, Math.max(0, (target - a.t) / span))
		function lerp3(pa: number[], pb: number[]) { return [lerp(pa[0], pb[0], f), lerp(pa[1], pb[1], f), lerp(pa[2], pb[2], f)] as [number,number,number] }
		const players: NetPlayer[] = []
		for (const pA of a.snap.players) {
			const pB = b.snap.players.find(x => x.id === pA.id) || pA
			players.push({
				...pA,
				pos: lerp3(pA.pos as any, pB.pos as any),
				vel: lerp3(pA.vel as any, pB.vel as any),
				yaw: lerpAngle(pA.yaw, pB.yaw, f),
				pitch: lerpAngle(pA.pitch, pB.pitch, f),
				mode: pB.mode
			})
		}
		return { ...b.snap, players }
	}
}
