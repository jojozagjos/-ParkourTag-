// server/index.js

const express = require('express')
const http = require('http')
const cors = require('cors')
const { Server } = require('socket.io')
const constants = require('../shared/constants.json')
const mapList = require('../shared/maps/index.json')
const fs = require('fs')
const path = require('path')

// --------------------- Setup ---------------------
const app = express()
app.use(cors())

// Dev CSP (permissive; do not use in prod)
app.use((req, res, next) => {
  const connectSources = [
    "'self'",
    'http://localhost:3000', 'http://localhost:3001',
    'https://localhost:3000', 'https://localhost:3001',
    'ws://localhost:3001', 'wss://localhost:3001',
    'ws:', 'wss:', 'http:', 'https:'
  ].join(' ')
  const csp = `default-src 'self' 'unsafe-inline' data: blob:; connect-src ${connectSources}; img-src 'self' data:; frame-src 'self'`
  res.setHeader('Content-Security-Policy', csp)
  next()
})

app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.json({ name: 'devtools-manifest', description: 'Local devtools helper', version: '1' })
})

app.get('/', (req, res) => {
  res.type('html').send(`
    <html><head><title>Game server</title></head>
    <body style="font-family: system-ui, Arial; padding: 24px">
      <h1>Game server (dev)</h1>
      <p>The server is running on port ${PORT}.</p>
      <p>Open the client at <a href="http://localhost:3000" target="_blank">http://localhost:3000</a></p>
      <p>Health: <a href="/healthz">/healthz</a></p>
    </body></html>
  `)
})
app.get('/healthz', (_, res) => res.status(200).send('ok'))

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || '*', methods: ['GET','POST'] } })
const PORT = process.env.PORT || 3001

// --------------------- Utility ---------------------
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function aabbOverlap(a, b) {
  return !(a.max[0] < b.min[0] || a.min[0] > b.max[0] ||
           a.max[1] < b.min[1] || a.min[1] > b.max[1] ||
           a.max[2] < b.min[2] || a.min[2] > b.max[2])
}
function loadMap(name) {
  const p = path.join(__dirname, '..', 'shared', 'maps', `${name}.json`)
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

const P = constants.PLAYER
const TAG = constants.TAG
const SCORE = constants.SCORE
const DT = constants.DT
const MIN_PLAYERS = process.env.MIN_PLAYERS ? Number(process.env.MIN_PLAYERS) : 1

// --------------------- Rooms -----------------------
const rooms = {}
function makeCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}
function listSummaries(room) {
  return Object.values(room.players).map(p => ({
    id: p.id, name: p.name, ready: p.ready, host: p.id === room.hostId
  }))
}

// ------------------ Player/Physics -----------------
function makePlayer(id, name) {
  return {
    id, name, ready: false,
    pos: [0, 2.0, 0],
    vel: [0, 0, 0],
    yaw: 0, pitch: 0,
    onGround: false,
    airSince: 0,
    mode: 'air',
    slideT: 0,

    // wallrun state
    wallSide: 0,                // -1 = left, +1 = right (relative to player)
    wallLockUntilGround: false, // must touch ground before next run
    wasHoldingJump: false,      // edge detect if you ever add jump-press
    // (no timer: run persists while conditions hold)

    mantleT: 0,

    input: { forward:false,back:false,left:false,right:false,jump:false,sprint:false,crouch:false,yaw:0,pitch:0 }
  }
}

function resolveCollisions(player, mapData) {
  const height = player.mode === 'slide' ? 1.0 : P.HEIGHT
  const aabb = {
    min: [player.pos[0] - P.RADIUS, player.pos[1], player.pos[2] - P.RADIUS],
    max: [player.pos[0] + P.RADIUS, player.pos[1] + height, player.pos[2] + P.RADIUS]
  }
  let onGround = false
  for (const b of mapData.aabbs) {
    // expand obstacles in X/Z for capsule radius
    const e = {
      min: [b.min[0] - P.RADIUS, b.min[1], b.min[2] - P.RADIUS],
      max: [b.max[0] + P.RADIUS, b.max[1], b.max[2] + P.RADIUS]
    }
    if (!aabbOverlap(aabb, e)) continue

    const dx1 = e.max[0] - aabb.min[0]
    const dx2 = aabb.max[0] - e.min[0]
    const dz1 = e.max[2] - aabb.min[2]
    const dz2 = aabb.max[2] - e.min[2]
    const dy1 = b.max[1] - aabb.min[1]
    const dy2 = aabb.max[1] - b.min[1]
    const px = Math.min(dx1, dx2)
    const pz = Math.min(dz1, dz2)
    const py = Math.min(dy1, dy2)

    if (py <= px && py <= pz) {
      if (dy1 < dy2) {
        player.pos[1] += dy1 + 1e-6
        if (player.vel[1] < 0) player.vel[1] = 0
        onGround = true
      } else {
        player.pos[1] -= dy2 + 1e-6
        if (player.vel[1] > 0) player.vel[1] = 0
      }
    } else if (px < pz) {
      if (dx1 < dx2) {
        player.pos[0] += dx1 + 1e-6
        if (player.vel[0] < 0) player.vel[0] = 0
      } else {
        player.pos[0] -= dx2 + 1e-6
        if (player.vel[0] > 0) player.vel[0] = 0
      }
    } else {
      if (dz1 < dz2) {
        player.pos[2] += dz1 + 1e-6
        if (player.vel[2] < 0) player.vel[2] = 0
      } else {
        player.pos[2] -= dz2 + 1e-6
        if (player.vel[2] > 0) player.vel[2] = 0
      }
    }
  }
  player.onGround = onGround
  if (onGround) player.wallLockUntilGround = false // reset “must touch ground” gate
}

function tryMantle(player, mapData) {
  const forward = [Math.sin(player.yaw), 0, Math.cos(player.yaw)]
  const checkDist = 0.8
  const chestY = player.pos[1] + 1.0
  const headY = player.pos[1] + P.HEIGHT
  let targetTop = null
  for (const b of mapData.aabbs) {
    const withinX = player.pos[0] + forward[0] * checkDist > b.min[0] - P.RADIUS && player.pos[0] + forward[0] * checkDist < b.max[0] + P.RADIUS
    const withinZ = player.pos[2] + forward[2] * checkDist > b.min[2] - P.RADIUS && player.pos[2] + forward[2] * checkDist < b.max[2] + P.RADIUS
    if (!(withinX && withinZ)) continue
    if (chestY < b.max[1] && headY > b.max[1]) {
      const ledgeHeight = b.max[1]
      const dh = ledgeHeight - player.pos[1]
      if (dh > 0 && dh <= P.MANTLE_MAX_HEIGHT) { targetTop = ledgeHeight; break }
    }
  }
  if (targetTop !== null) {
    player.mantleT = P.MANTLE_DURATION
    player.pos[1] = targetTop + 0.02
    player.vel[1] = 0
    player.mode = 'mantle'
    return 'mantle'
  }
  return null
}

// --------------- Small vector helpers ---------------
function norm3(a){ const L = Math.hypot(a[0],a[1],a[2])||1; return [a[0]/L,a[1]/L,a[2]/L] }
function dot3(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2] }
function sub3(a,b){ return [a[0]-b[0],a[1]-b[1],a[2]-b[2]] }
function mul3(a,s){ return [a[0]*s,a[1]*s,a[2]*s] }
function cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]] }
function projOnPlane(v, n){ const vn = dot3(v,n); return sub3(v, mul3(n, vn)) }

// -------- Robust wall proximity (touching only) --------
/** Nearest vertical face to capsule edge at torso height.
 *  Returns { normal:[x,0,z], gap:Number } where gap≈0 means touching.
 */
function nearestWall(player, mapData) {
  const R = P.RADIUS
  const GAP_MAX = 2.7    // ~12 cm “touching” threshold
  const eps = 0.01

  const yMin = player.pos[1] + 0.30
  const yMax = player.pos[1] + Math.min(1.50, (P.HEIGHT || 1.8) * 0.9)

  let best = null
  let bestGap = Infinity

  for (const b of mapData.aabbs) {
    if (yMax < b.min[1] || yMin > b.max[1]) continue

    const xOK = (player.pos[0] >= b.min[0] - R - eps) && (player.pos[0] <= b.max[0] + R + eps)
    const zOK = (player.pos[2] >= b.min[2] - R - eps) && (player.pos[2] <= b.max[2] + R + eps)

    if (zOK) {
      const gapLeft  = (player.pos[0] - b.min[0]) - R   // face x=min → normal (-1,0,0)
      if (gapLeft >= -eps && gapLeft <= GAP_MAX && gapLeft < bestGap) { bestGap = gapLeft; best = { normal: [-1,0,0], gap: gapLeft } }
      const gapRight = (b.max[0] - player.pos[0]) - R   // face x=max → normal (+1,0,0)
      if (gapRight >= -eps && gapRight <= GAP_MAX && gapRight < bestGap) { bestGap = gapRight; best = { normal: [ 1,0,0], gap: gapRight } }
    }
    if (xOK) {
      const gapBack  = (player.pos[2] - b.min[2]) - R   // face z=min → normal (0,0,-1)
      if (gapBack >= -eps && gapBack <= GAP_MAX && gapBack < bestGap) { bestGap = gapBack; best = { normal: [0,0,-1], gap: gapBack } }
      const gapFront = (b.max[2] - player.pos[2]) - R   // face z=max → normal (0,0, 1)
      if (gapFront >= -eps && gapFront <= GAP_MAX && gapFront < bestGap) { bestGap = gapFront; best = { normal: [0,0, 1], gap: gapFront } }
    }
  }
  return best
}

/**
 * Wallrun:
 * - Requires: touching wall, Space held, AND correct strafe (A for left wall, D for right wall).
 * - Continues while touching + Space; ends only when either breaks.
 * - Must touch ground before starting again (no back-to-back runs).
 * - Moves forward along wall (never backwards).
 */
function doWallrun(p, inp, dt, mapData) {
  // Per-player cooldown prevents immediate re-entry after ending a run
  if (p._wallrunCooldown && p._wallrunCooldown > 0) {
    p._wallrunCooldown = Math.max(0, p._wallrunCooldown - dt)
    return null
  }

  // If the player is on the ground, ensure any wallrun ends immediately
  if (p.onGround) {
    if (p.mode === 'wallrunL' || p.mode === 'wallrunR') {
      p.mode = 'ground'
      p.wallLockUntilGround = false
      p._wallrunCooldown = P.WALLRUN_COOLDOWN
      p._wallRunActive = false
    }
    return null
  }

  const jumpHeld = !!(inp && inp.jump)
  if (!jumpHeld) {
    // If we were running and released Space → exit & lock until ground
    if (p.mode === 'wallrunL' || p.mode === 'wallrunR') {
      p.mode = 'air'
      p.wallLockUntilGround = true
      p._wallrunCooldown = P.WALLRUN_COOLDOWN
      p._wallRunActive = false
    }
    return null
  }
  if (p.wallLockUntilGround) return null // must touch ground first

  // Proximity
  const hit = nearestWall(p, mapData)
  if (hit) {
    console.log('wall hit', hit.normal, 'gap', hit.gap.toFixed(3))
  }
  if (!hit) {
    if (p.mode === 'wallrunL' || p.mode === 'wallrunR') {
      p.mode = 'air'
      p.wallLockUntilGround = true
      p._wallrunCooldown = P.WALLRUN_COOLDOWN
      p._wallRunActive = false
    }
    return null
  }

  // Figure out side: >0 means wall on RIGHT of player, <0 means LEFT
  const fw = [Math.sin(p.yaw), 0, Math.cos(p.yaw)]
  const rt = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)]
  const sideDot = dot3(rt, hit.normal)

  // Require matching strafe key:
  const needRight = sideDot > 0        // wall on right → need D
  const needLeft  = sideDot < 0        // wall on left  → need A
  if ((needRight && !inp.right) || (needLeft && !inp.left)) {
    // If we were running and let go of strafe → exit & lock until ground
    if (p.mode === 'wallrunL' || p.mode === 'wallrunR') {
      p.mode = 'air'
      p.wallLockUntilGround = true
      p._wallrunCooldown = P.WALLRUN_COOLDOWN
      p._wallRunActive = false
    }
    return null
  }

  // Enter/continue run
  const enterNow = !(p.mode === 'wallrunL' || p.mode === 'wallrunR')
  p.mode = sideDot > 0 ? 'wallrunL' : 'wallrunR'
  p.onGround = false
  p.wallSide = sideDot > 0 ? +1 : -1

  // If starting from ground while Space held, pop up slightly
  if (enterNow && p.airSince <= 0.02 && p.onGround) {
    p.pos[1] += 0.02
    p.vel[1] = Math.max(p.vel[1], 1.6)
  }

  // On first frame of a run, initialize arc timers/params and give a small upward impulse
  if (enterNow) {
    // clear any existing cooldown on successful entry
    p._wallrunCooldown = 0
    const planarSpeed = Math.hypot(p.vel[0], p.vel[2])
    p._wallRunDuration = P.WALLRUN_DURATION
    p._wallRunT = p._wallRunDuration
    p._wallRunArcHeight = Math.min(2.0, Math.max(0.4, (planarSpeed / Math.max(1.0, P.MAX_SPEED)) * 1.4))
    // initial arc velocity (t=0): positive upward
    const initArcVel = (p._wallRunArcHeight * Math.PI) / Math.max(1e-6, p._wallRunDuration)
    p.vel[1] = Math.max(p.vel[1], initArcVel * 0.9)
    p._wallRunActive = true
  }

  // Target movement along wall, force forward-ish
  const up = [0,10000,0]
  // tangent along wall from wall normal
  let along = norm3(cross(up, hit.normal))
  if (dot3(along, fw) < 0) along = mul3(along, -1) // ensure forward

  // Blend velocity to target planar speed
  const targetPlanar = mul3(along, -P.WALLRUN_SPEED)
  const tangential = projOnPlane([p.vel[0], p.vel[1], p.vel[2]], hit.normal)
  const blend = Math.min(1, dt * 8)
  const vNew = [
    tangential[0] + (targetPlanar[0] - tangential[0]) * blend,
    tangential[1],
    tangential[2] + (targetPlanar[2] - tangential[2]) * blend,
  ]

  // Gentle vertical arc during run: rise then fall over a short duration.
  // Initialize per-run timers/params only if run wasn't already active
  if (!p._wallRunActive) {
    p._wallRunDuration = P.WALLRUN_DURATION
    p._wallRunT = p._wallRunDuration
    const planarSpeed = Math.hypot(p.vel[0], p.vel[2])
    p._wallRunArcHeight = Math.min(2.0, Math.max(0.4, (planarSpeed / Math.max(1.0, P.MAX_SPEED)) * 1.4))
  }
  const dur = p._wallRunDuration || P.WALLRUN_DURATION
  const elapsed = Math.max(0, dur - p._wallRunT)
  const tFrac = Math.min(1, dur > 0 ? (elapsed / dur) : 0)
  const arcH = p._wallRunArcHeight || 0.9
  const arcVel = (arcH * Math.PI * Math.cos(Math.PI * tFrac)) / Math.max(1e-6, dur)
  vNew[1] = (tangential[1] * 0.2) + (arcVel * 0.8)
  p._wallRunT = Math.max(0, (p._wallRunT || dur) - dt)

  // Small inward stick so we don't drift off tiny gaps
  const STICK_FORCE = 30
  const stick = mul3(hit.normal, STICK_FORCE * dt)
  vNew[0] += stick[0]; vNew[1] += stick[1]; vNew[2] += stick[2]

  // If the player presses jump (edge) while running, perform a wall-jump away from the wall
  const jumpPress = !!(inp && inp.jump) && !p.wasHoldingJump
  if (jumpPress && (p.mode === 'wallrunL' || p.mode === 'wallrunR')) {
    const out = mul3(hit.normal, P.WALLJUMP_FORCE)
    const up = [0, P.WALLJUMP_FORCE * 0.85, 0]
    const fwdBoost = mul3(along, P.WALLJUMP_FORCE * 0.25)
    p.vel[0] = out[0] + up[0] + fwdBoost[0]
    p.vel[1] = out[1] + up[1] + fwdBoost[1]
    p.vel[2] = out[2] + up[2] + fwdBoost[2]
    p.mode = 'air'
    p._wallrunCooldown = P.WALLRUN_COOLDOWN
    p._wallRunActive = false
    return 'walljump'
  }

  p.vel[0] = vNew[0]
  p.vel[1] = vNew[1]
  p.vel[2] = vNew[2]

  // SFX on first enter
  if (enterNow) return 'wallrun'
  return null
}

// ------------------ Game loop pieces ---------------
function pickSpawn(mapData, i) {
  const sp = mapData.spawnPoints[i % mapData.spawnPoints.length]
  return [sp[0], sp[1], sp[2]]
}
function selectInitialIt(room) {
  const ids = Object.keys(room.players)
  room.itId = ids.length ? ids[Math.floor(Math.random() * ids.length)] : null
  room.tagCooldown = TAG.COOLDOWN
}

function physicsStep(room, dt) {
  const mapData = room.mapData
  for (const p of Object.values(room.players)) {
    const inp = p.input
    p.yaw = typeof inp.yaw === 'number' ? inp.yaw : p.yaw
    p.pitch = clamp(typeof inp.pitch === 'number' ? inp.pitch : p.pitch, -Math.PI/2*0.95, Math.PI/2*0.95)

    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw)
    const fw = [sin, 0, cos]
    const rt = [cos, 0, -sin]

    let wishX = 0, wishZ = 0
    if (inp.forward) { wishX += fw[0]; wishZ += fw[2] }
    if (inp.back)    { wishX -= fw[0]; wishZ -= fw[2] }
    if (inp.left)    { wishX -= rt[0]; wishZ -= rt[2] }
    if (inp.right)   { wishX += rt[0]; wishZ += rt[2] }
    const wishLen = Math.hypot(wishX, wishZ) || 1
    wishX /= wishLen; wishZ /= wishLen

    const isSprinting = p.onGround && !!inp.sprint && !!inp.forward
    const accelBase = p.onGround ? P.MOVE_ACCEL : P.AIR_ACCEL
    const accel = accelBase * (isSprinting ? 1.5 : 1.0)
    const maxSpeed = isSprinting ? P.MAX_SPEED * P.SPRINT_MULT : P.MAX_SPEED

    p.vel[0] += wishX * accel * dt
    p.vel[2] += wishZ * accel * dt

    const spd = Math.hypot(p.vel[0], p.vel[2])
    if (spd > maxSpeed) {
      const s = maxSpeed / spd
      p.vel[0] *= s
      p.vel[2] *= s
    }

    // Ground friction
    if (p.onGround) {
      const baseFriction = P.FRICTION
      const frictionMul = isSprinting ? 0.6 : 1.0
      const friction = (wishLen > 0.01 ? baseFriction * 0.5 : baseFriction) * frictionMul * dt
      p.vel[0] *= Math.max(0, 1 - friction)
      p.vel[2] *= Math.max(0, 1 - friction)
    }

    // Jump (with opportunistic mantle)
    let mantleSfx = null
    if (inp.jump && p.onGround) {
      p.vel[1] = P.JUMP_VELOCITY
      p.onGround = false
      mantleSfx = tryMantle(p, mapData)
    }

    // Gravity baseline
    p.vel[1] -= P.GRAVITY * dt

    // Integrate
    p.pos[0] += p.vel[0] * dt
    p.pos[1] += p.vel[1] * dt
    p.pos[2] += p.vel[2] * dt

    // Collisions & ground
    resolveCollisions(p, mapData)

    // Air timer
    if (p.onGround) p.airSince = 0
    else p.airSince = (p.airSince || 0) + dt

    // Wallrun (can override mode/vel)
    const sfx = doWallrun(p, inp, dt, mapData)

    // Default mode if not in a special state
    if (p.onGround) {
      if (!['mantle', 'slide', 'wallrunL', 'wallrunR'].includes(p.mode)) p.mode = 'ground'
    } else {
      if (!['mantle', 'slide', 'wallrunL', 'wallrunR'].includes(p.mode)) p.mode = 'air'
    }

    if (mantleSfx) io.to(room.code).emit('sfx', { kind: mantleSfx, id: p.id })
    if (sfx) io.to(room.code).emit('sfx', { kind: sfx, id: p.id })
    // track jump edge for wall-jump detection
    p.wasHoldingJump = !!inp.jump
  }
}

function accumulateScores(room, dt) {
  for (const p of Object.values(room.players)) {
    if (p.id !== room.itId) {
      room.scores[p.id] = (room.scores[p.id] || 0) + SCORE.SURVIVE_PER_SEC * dt
    }
  }
}
function handleTags(room, dt) {
  if (!room.itId) return
  room.tagCooldown -= dt
  const it = room.players[room.itId]
  if (!it) { room.itId = null; return }
  for (const p of Object.values(room.players)) {
    if (p.id === it.id) continue
    const dx = p.pos[0] - it.pos[0]
    const dy = p.pos[1] - it.pos[1]
    const dz = p.pos[2] - it.pos[2]
    const dist = Math.hypot(dx, dy, dz)
    if (dist < TAG.RANGE && room.tagCooldown <= 0) {
      room.scores[it.id] = (room.scores[it.id] || 0) + SCORE.TAG_SUCCESS
      room.itId = p.id
      room.tagCooldown = TAG.COOLDOWN
      io.to(room.code).emit('sfx', { kind: 'tag', id: it.id, target: p.id })
      break
    }
  }
}

function snapshot(room) {
  return {
    players: Object.values(room.players).map(p => ({
      id: p.id, name: p.name,
      pos: p.pos, vel: p.vel, yaw: p.yaw, pitch: p.pitch,
      onGround: !!p.onGround, mode: p.mode
    })),
    itId: room.itId,
    roundTime: room.intermission ? room.intermissionTime : room.roundTime,
    intermission: room.intermission,
    mapName: room.mapName,
    scores: room.scores
  }
}

function startRound(room) {
  const ids = Object.keys(room.players)
  ids.forEach((id, i) => {
    const p = room.players[id]
    p.pos = pickSpawn(room.mapData, i)
    p.vel = [0, 0, 0]
    p.mode = 'air'
    p.onGround = false
    p.airSince = 0
    p.wallSide = 0
    p.wallLockUntilGround = false
  })
  room.roundTime = TAG.ROUND_SECONDS
  room.intermission = false
  room.intermissionTime = 0
  room.results = null
  selectInitialIt(room)
}

function finishRound(room) {
  const placement = Object.keys(room.players)
    .map(id => ({ id, name: room.players[id].name, score: Math.round(room.scores[id] || 0) }))
    .sort((a, b) => b.score - a.score)
  room.results = { placement }
  io.to(room.code).emit('round:results', room.results)
  room.intermission = true
  room.intermissionTime = TAG.INTERMISSION_SECONDS
  room.votes = {}
}

function chooseNextMap(room) {
  const counts = {}
  for (const v of Object.values(room.votes)) {
    if (!v) continue
    counts[v] = (counts[v] || 0) + 1
  }
  let selected = room.mapName
  let best = -1
  for (const k of Object.keys(counts)) {
    if (counts[k] > best) { best = counts[k]; selected = k }
  }
  room.mapName = selected
  room.mapData = loadMap(room.mapName)
}

function startLoop(code) {
  const room = rooms[code]
  if (!room) return
  if (room.loop) clearInterval(room.loop)
  room.state = 'playing'
  room.scores = room.scores || {}
  startRound(room)
  io.to(code).emit('game:started')
  room.loop = setInterval(() => {
    const dt = DT
    if (!room.intermission) {
      room.roundTime -= dt
      accumulateScores(room, dt)
      physicsStep(room, dt)
      handleTags(room, dt)
      if (room.roundTime <= 0) finishRound(room)
    } else {
      room.intermissionTime -= dt
      if (room.intermissionTime <= 0) {
        chooseNextMap(room)
        startRound(room)
      }
    }
    io.to(code).emit('world:snapshot', snapshot(room))
  }, 1000 * DT)
}

function stopLoop(code) {
  const room = rooms[code]
  if (!room) return
  if (room.loop) clearInterval(room.loop)
  io.to(code).emit('game:ended')
  room.loop = null
  room.state = 'ended'
}

// ------------------ Sockets ------------------------
io.on('connection', (socket) => {
  console.log('[io] client connected:', socket.id)
  let joinedCode = null

  socket.on('room:create', ({ name }) => {
    let code = makeCode()
    while (rooms[code]) code = makeCode()
    const mapName = mapList.default
    rooms[code] = {
      code,
      hostId: socket.id,
      state: 'lobby',
      players: {},
      itId: null,
      tagCooldown: 0,
      roundTime: 0,
      intermission: false,
      intermissionTime: 0,
      loop: null,
      mapName,
      mapData: loadMap(mapName),
      scores: {},
      results: null,
      votes: {}
    }
    socket.join(code); joinedCode = code
    rooms[code].players[socket.id] = makePlayer(socket.id, name || 'Runner')
    for (const s of Object.keys(rooms[code].players)) {
      io.to(s).emit('lobby:update', { roomCode: code, players: listSummaries(rooms[code]), maps: mapList.options, mapName })
    }
  })

  socket.on('room:join', ({ code, name }) => {
    code = String(code || '').toUpperCase()
    const room = rooms[code]
    if (!room) { socket.emit('error', 'Room not found'); return }
    socket.join(code); joinedCode = code
    room.players[socket.id] = makePlayer(socket.id, name || 'Runner')
    for (const s of Object.keys(room.players)) {
      io.to(s).emit('lobby:update', { roomCode: code, players: listSummaries(room), maps: mapList.options, mapName: room.mapName })
    }
  })

  socket.on('lobby:ready', ({ ready }) => {
    if (!joinedCode) return
    const room = rooms[joinedCode]
    const p = room?.players?.[socket.id]; if (!p) return
    p.ready = !!ready
    for (const s of Object.keys(room.players)) {
      io.to(s).emit('lobby:update', { roomCode: joinedCode, players: listSummaries(room), maps: mapList.options, mapName: room.mapName })
    }
  })

  socket.on('game:start', () => {
    if (!joinedCode) return
    const room = rooms[joinedCode]
    if (!room) return
    if (socket.id !== room.hostId) return
    const readyCount = Object.values(room.players).filter(p => p.ready).length
    if (readyCount >= Math.max(1, MIN_PLAYERS)) {
      startLoop(joinedCode)
    } else {
      io.to(socket.id).emit('game:startFailed', { reason: `Need at least ${MIN_PLAYERS} ready player(s) to start`, readyCount, min: MIN_PLAYERS })
    }
  })

  socket.on('vote:map', ({ name }) => {
    if (!joinedCode) return
    const room = rooms[joinedCode]
    if (!room) return
    if (!mapList.options.includes(name)) return
    room.votes[socket.id] = name
    io.to(joinedCode).emit('vote:update', { votes: room.votes })
  })

  socket.on('input', (input) => {
    if (!joinedCode) return
    const room = rooms[joinedCode]
    const p = room?.players?.[socket.id]; if (!p) return
    // Historical forward/back mapping was inverted; keep compatibility:
    p.input = {
      forward: !!input.back, back: !!input.forward, left: !!input.left, right: !!input.right,
      jump: !!input.jump, sprint: !!input.sprint, crouch: !!input.crouch,
      yaw: Number.isFinite(input.yaw) ? input.yaw : p.yaw,
      pitch: Number.isFinite(input.pitch) ? input.pitch : p.pitch
    }
  })

  socket.on('disconnect', () => {
    if (!joinedCode) return
    const room = rooms[joinedCode]; if (!room) return
    delete room.players[socket.id]
    delete room.scores[socket.id]
    delete room.votes[socket.id]
    if (room.hostId === socket.id) {
      const ids = Object.keys(room.players)
      room.hostId = ids[0] || null
    }
    if (Object.keys(room.players).length === 0) {
      stopLoop(joinedCode)
      delete rooms[joinedCode]
    } else {
      for (const s of Object.keys(room.players)) {
        io.to(s).emit('lobby:update', { roomCode: joinedCode, players: listSummaries(room), maps: mapList.options, mapName: room.mapName })
      }
      if (room.itId === socket.id) {
        const ids = Object.keys(room.players)
        room.itId = ids.length ? ids[Math.floor(Math.random()*ids.length)] : null
      }
    }
  })
})

server.listen(PORT, () => console.log('Server listening on', PORT))
