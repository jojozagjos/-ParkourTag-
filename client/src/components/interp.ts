import type { Snapshot, NetPlayer } from '../types'

type Buffered = { t: number, snap: Snapshot }
// Slightly larger buffer smooths jitter at the cost of a tiny added latency
// Reduce buffer to make the game feel more responsive (lower visual latency)
const BUFFER_MS = 60

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
		const spanMs = Math.max(1, b.t - a.t)
		const f = Math.min(1, Math.max(0, (target - a.t) / spanMs))
		const spanSec = spanMs / 1000
		function hermite3(p0: number[], v0: number[], p1: number[], v1: number[]) {
			// Cubic Hermite interpolation using end velocities
			const u = f
			const u2 = u * u
			const u3 = u2 * u
			const h00 = 2*u3 - 3*u2 + 1
			const h10 = u3 - 2*u2 + u
			const h01 = -2*u3 + 3*u2
			const h11 = u3 - u2
			return [
				h00 * p0[0] + h10 * (v0[0] * spanSec) + h01 * p1[0] + h11 * (v1[0] * spanSec),
				h00 * p0[1] + h10 * (v0[1] * spanSec) + h01 * p1[1] + h11 * (v1[1] * spanSec),
				h00 * p0[2] + h10 * (v0[2] * spanSec) + h01 * p1[2] + h11 * (v1[2] * spanSec),
			] as [number, number, number]
		}
		const players: NetPlayer[] = []
		for (const pA of a.snap.players) {
			const pB = b.snap.players.find(x => x.id === pA.id) || pA
			const pos = hermite3(pA.pos as any, pA.vel as any, pB.pos as any, pB.vel as any)
			const vel = [
				lerp(pA.vel[0], pB.vel[0], f),
				lerp(pA.vel[1], pB.vel[1], f),
				lerp(pA.vel[2], pB.vel[2], f),
			] as [number, number, number]
			players.push({
				...pA,
				pos,
				vel,
				yaw: lerpAngle(pA.yaw, pB.yaw, f),
				pitch: lerpAngle(pA.pitch, pB.pitch, f),
				mode: pB.mode
			})
		}
		return { ...b.snap, players }
	}
}
