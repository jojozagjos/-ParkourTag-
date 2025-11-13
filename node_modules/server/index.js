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
    'http://localhost:3000',
    'https://localhost:3000',
    'ws://localhost:3000', 'wss://localhost:3000',
    'ws:', 'wss:', 'http:', 'https:'
  ].join(' ')
  const csp = `default-src 'self' 'unsafe-inline' data: blob:; connect-src ${connectSources}; img-src 'self' data:; frame-src 'self'`
  res.setHeader('Content-Security-Policy', csp)
  next()
})

app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.json({ name: 'devtools-manifest', description: 'Local devtools helper', version: '1' })
})

// Static client build (serve client/dist). If not built, fallback page remains.
const clientDist = path.join(__dirname, '..', 'client', 'dist')
const clientAssets = path.join(__dirname, '..', 'client', 'assets')
// Serve raw assets referenced at runtime by absolute paths like "/assets/…"
if (fs.existsSync(clientAssets)) {
  app.use('/assets', express.static(clientAssets, { fallthrough: true }))
}
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false }))
  // SPA fallback: always return built index.html for unknown paths (except API & health)
  app.get('/', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
  app.get(/^(?!\/healthz).*/, (req, res, next) => {
    // If the request would have matched a static file it is served already; otherwise send index.html
    if (req.method !== 'GET') return next()
    res.sendFile(path.join(clientDist, 'index.html'))
  })
} else {
  app.get('/', (req, res) => {
    res.type('html').send(`
      <html><head><title>Game server</title></head>
      <body style="font-family: system-ui, Arial; padding: 24px">
        <h1>Game server (dev)</h1>
        <p>Client build not found (expected at /client/dist). Deploy the client or run build.</p>
        <p>Health: <a href="/healthz">/healthz</a></p>
      </body></html>
    `)
  })
}
app.get('/healthz', (_, res) => res.status(200).send('ok'))

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || '*', methods: ['GET','POST'] } })
const PORT = process.env.PORT || 3000

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
const IT = constants.IT || {}
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
    color: '#f0b46d',
    face: 'smile',
    hat: 'none',
    faceData: null,
    onGround: false,
    airSince: 0,
    mode: 'air',
    // slide
    slideT: 0,
  slideCd: 0,
    chainT: 0,
  chainStacks: 0,
    crouchSince: 0,
    // jump buffer & tic-tac
    jumpBufferedT: 0,
    tictacCd: 0,
    // wallrun state
    wasHoldingJump: false,      // edge detect if you ever add jump-press
    _wallrunBoostUsed: false,   // allow one outward boost per run
    // (no timer: run persists while conditions hold)

    mantleT: 0,
    mantleFromY: 0,
    mantleToY: 0,

  // IT ability selection and timers (default now 'dash')
  itAbility: 'dash',
    itDashT: 0,
    itDashCd: 0,
    itGrappleActive: false,
    itGrappleTarget: null,
    itGrappleCd: 0,
    _abilityHold: false,
    input: { forward:false,back:false,left:false,right:false,jump:false,sprint:false,crouch:false,ability:false,yaw:0,pitch:0 }
  }
}

function resolveCollisions(player, mapData) {
  const height = player.mode === 'slide'
    ? Math.max(1.0, P.HEIGHT - 0.6)
    : (player.mode === 'crouch' ? (P.CROUCH_HEIGHT || (P.HEIGHT - 0.25)) : P.HEIGHT)
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
}

// Check if there is enough vertical headroom to stand upright at current XZ.
// Returns true if no obstacle intersects the additional head region between current height and full standing height.
function hasHeadClearance(player, mapData) {
  const currentHeight = player.mode === 'slide'
    ? Math.max(1.0, P.HEIGHT - 0.6)
    : (player.mode === 'crouch' ? (P.CROUCH_HEIGHT || (P.HEIGHT - 0.25)) : P.HEIGHT)
  if (currentHeight >= P.HEIGHT - 1e-4) return true
  const headMinY = player.pos[1] + currentHeight
  const headMaxY = player.pos[1] + P.HEIGHT
  const aabb = {
    min: [player.pos[0] - P.RADIUS, headMinY, player.pos[2] - P.RADIUS],
    max: [player.pos[0] + P.RADIUS, headMaxY, player.pos[2] + P.RADIUS]
  }
  for (const b of mapData.aabbs) {
    // Expand obstacle by radius in X/Z only
    const e = {
      min: [b.min[0] - P.RADIUS, b.min[1], b.min[2] - P.RADIUS],
      max: [b.max[0] + P.RADIUS, b.max[1], b.max[2] + P.RADIUS]
    }
    if (aabbOverlap(aabb, e)) return false
  }
  return true
}

// Returns true if there is enough vertical space to fully stand plus a small margin
function canStandUp(player, mapData, margin = 0.08) {
  const clearance = overheadClearance(player, mapData)
  if (clearance === Infinity) return true
  return clearance >= (P.HEIGHT + margin)
}

// Returns vertical clearance (distance from player's feet Y to nearest underside above) or Infinity if open.
function overheadClearance(player, mapData) {
  const R = P.RADIUS
  let nearest = Infinity
  for (const b of mapData.aabbs) {
    if (player.pos[0] >= b.min[0] - R && player.pos[0] <= b.max[0] + R && player.pos[2] >= b.min[2] - R && player.pos[2] <= b.max[2] + R) {
      if (b.min[1] > player.pos[1] + 0.05 && b.min[1] < nearest) nearest = b.min[1]
    }
  }
  return nearest === Infinity ? Infinity : (nearest - player.pos[1])
}

function tryMantle(player, mapData) {
  // Use camera forward; previous sign caused mantling to work when facing away
  const forward = [-Math.sin(player.yaw), 0, -Math.cos(player.yaw)]
  const checkDist = 1.0
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
    // Initialize smooth mantle animation
    player.mantleFromY = player.pos[1]
    player.mantleToY = targetTop + 0.02
    player.mantleT = P.MANTLE_DURATION
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
 * Wallrun (updated):
 * - Requires: airborne + touching vertical wall + correct strafe key toward wall side (A for left, D for right).
 * - Disallowed if player is facing directly into the wall (facingDot > 0.5): only side contacts.
 * - Persists automatically while conditions hold (no jump-hold necessary).
 * - Single outward boost per run on jump press edge; preserves forward momentum and kicks away.
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

  // Proximity
  const hit = nearestWall(p, mapData)
  if (!hit) {
    if (p.mode === 'wallrunL' || p.mode === 'wallrunR') {
      p.mode = 'air'
      p._wallrunCooldown = P.WALLRUN_COOLDOWN
      p._wallRunActive = false
    }
    return null
  }

  // Figure out side: >0 means wall on RIGHT of player, <0 means LEFT
  // Use the same forward convention as mantling (camera forward)
  const fw = [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)]
  const rt = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)]
  const sideDot = dot3(rt, hit.normal)
  const facingDot = Math.abs(dot3(fw, hit.normal)) // 1 = facing straight into wall

  // Require matching strafe key:
  const needRight = sideDot > 0        // wall on right → need D
  const needLeft  = sideDot < 0        // wall on left  → need A
  // Wall must be to the side, not head-on; require sideways alignment
  if (facingDot > 0.5) {
    if (p.mode === 'wallrunL' || p.mode === 'wallrunR') {
      p.mode = 'air'
      p._wallrunCooldown = P.WALLRUN_COOLDOWN
      p._wallRunActive = false
    }
    return null
  }
  if ((needRight && !inp.right) || (needLeft && !inp.left)) {
    // If we were running and let go of strafe → exit
    if (p.mode === 'wallrunL' || p.mode === 'wallrunR') {
      p.mode = 'air'
      p._wallrunCooldown = P.WALLRUN_COOLDOWN
      p._wallRunActive = false
    }
    return null
  }

  // Enter/continue run
  const enterNow = !(p.mode === 'wallrunL' || p.mode === 'wallrunR')
  const wasOnGround = p.onGround
  p.mode = sideDot > 0 ? 'wallrunL' : 'wallrunR'
  p.onGround = false

  // If starting from ground, pop up slightly
  if (enterNow && p.airSince <= 0.02 && wasOnGround) {
    p.pos[1] += 0.02
    p.vel[1] = Math.max(p.vel[1], 1.6)
  }

  // On first frame of a run, initialize arc timers/params and give a small upward impulse
  if (enterNow) {
    // clear any existing cooldown on successful entry
    p._wallrunCooldown = 0
    p._wallrunBoostUsed = false
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
  // Align along-the-wall direction with camera forward vector
  if (dot3(along, fw) < 0) along = mul3(along, -1)

  // Blend velocity toward along-the-wall target while preserving (not reducing) existing forward momentum
  const planarBefore = [p.vel[0], 0, p.vel[2]]
  const alongSpeed = dot3(planarBefore, along)
  // Don't flip direction or steal speed: only accelerate up to at least WALLRUN_SPEED
  const desiredSpeed = Math.max(P.WALLRUN_SPEED, alongSpeed)
  const targetPlanar = mul3(along, desiredSpeed)
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

  // Titanfall-style outward boost: fresh Space press during wallrun propels away from wall once.
  const jumpPress = !!(inp && inp.jump) && !p.wasHoldingJump
  if (jumpPress && (p.mode === 'wallrunL' || p.mode === 'wallrunR') && !p._wallrunBoostUsed) {
    p._wallrunBoostUsed = true
    // Preserve forward momentum and kick clearly away from wall
    const baseForce = P.WALLJUMP_FORCE || 6.5
    const planarBefore = [p.vel[0], 0, p.vel[2]]
    const alongSpeed = dot3(planarBefore, along)
    const preservedAlong = mul3(along, Math.max(0, alongSpeed))
    const nWall = norm3([hit.normal[0], 0, hit.normal[2]])
  const out = mul3(nWall, -1) // ensure we push away from wall
    const outwardSpeed = baseForce * 1.4 + Math.max(0, alongSpeed) * 0.50
    const exitForwardBoost = baseForce * 0.12
    let planarNew = [
      preservedAlong[0] + out[0] * outwardSpeed + along[0] * exitForwardBoost,
      0,
      preservedAlong[2] + out[2] * outwardSpeed + along[2] * exitForwardBoost,
    ]
    // Remove any inward component relative to outward direction
    const outDot = dot3(planarNew, out)
    if (outDot < 0) {
      planarNew[0] += out[0] * (-outDot)
      planarNew[2] += out[2] * (-outDot)
    }
    p.vel[0] = planarNew[0]
    p.vel[2] = planarNew[2]
    // Vertical kept modest
    const upVel = baseForce * 0.25 + Math.max(0, alongSpeed) * 0.06
    p.vel[1] = Math.max(p.vel[1], upVel)
    // Small positional nudge to avoid immediate re-collision
    p.pos[0] += out[0] * 0.05
    p.pos[2] += out[2] * 0.05
    p.mode = 'air'
    p._wallrunCooldown = P.WALLRUN_COOLDOWN * 0.5
    p._wallRunActive = false
  p.chainT = Math.max(p.chainT || 0, (P.CHAIN_TIME || 0.4))
  p.chainStacks = Math.min((P.CHAIN_MAX_STACKS || 5), (p.chainStacks || 0) + 1)
    return 'jump'
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
  let choices = ids
  if (ids.length > 1 && room.prevItId && ids.includes(room.prevItId)) {
    choices = ids.filter(id => id !== room.prevItId)
  }
  room.itId = choices.length ? choices[Math.floor(Math.random() * choices.length)] : null
  room.prevItId = room.itId
  room.tagCooldown = TAG.COOLDOWN
}

function physicsStep(room, dt) {
  const mapData = room.mapData
  for (const p of Object.values(room.players)) {
    const inp = p.input
    const wasOnGroundBefore = !!p.onGround
    p.yaw = typeof inp.yaw === 'number' ? inp.yaw : p.yaw
    p.pitch = clamp(typeof inp.pitch === 'number' ? inp.pitch : p.pitch, -Math.PI/2*0.95, Math.PI/2*0.95)

    // Handle mantle animation as a special state (freeze controls/gravity)
    if (p.mode === 'mantle') {
      const dur = Math.max(1e-6, P.MANTLE_DURATION)
      p.mantleT = Math.max(0, p.mantleT - dt)
      const t = 1 - (p.mantleT / dur)
      // ease in-out (smoothstep)
      const u = t * t * (3 - 2 * t)
      const y = p.mantleFromY + (p.mantleToY - p.mantleFromY) * u
      p.pos[1] = y
      p.vel[1] = 0
      p.onGround = false
      if (p.mantleT <= 0) {
        p.pos[1] = p.mantleToY
        p.vel[1] = Math.max(p.vel[1], 2.0)
        p.mode = 'air'
  p.chainT = Math.max(p.chainT || 0, (P.CHAIN_TIME || 0.3))
  p.chainStacks = Math.min((P.CHAIN_MAX_STACKS || 5), (p.chainStacks || 0) + 1)
      }
      // Skip rest of physics this tick for mantle
      // Still emit snapshot later in loop
      continue
    }

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
  let maxSpeed = isSprinting ? P.MAX_SPEED * P.SPRINT_MULT : P.MAX_SPEED
    // Apply dash speed multiplier if active. In 'runners' gamemode, non-IT players may also have dash active.
    if (p.itAbility === 'dash' && p.itDashT > 0 && room.gameMode !== 'noAbility' && (room.gameMode === 'runners' || room.itId === p.id)) {
      maxSpeed *= (IT.DASH_SPEED_MULT || 1.5)
    }
    // Chain-based speed multiplier scales with accumulated chain stacks.
    const chainStacks = (p.chainStacks || 0)
    if (chainStacks > 0) {
      const maxStacks = (P.CHAIN_MAX_STACKS || 5)
      const baseMult = (P.CHAIN_SPEED_MULT || 1.0)
      const chainMultiplier = 1 + (baseMult - 1) * (Math.min(chainStacks, maxStacks) / maxStacks)
      maxSpeed *= chainMultiplier
    }

    p.vel[0] += wishX * accel * dt
    p.vel[2] += wishZ * accel * dt

    // Turn-brake: if desired direction opposes current planar velocity, apply an extra braking force
    if (wishLen > 0.01) {
      const dotWishVel = p.vel[0] * wishX + p.vel[2] * wishZ
      if (dotWishVel < -0.01) {
        const planarSpd = Math.hypot(p.vel[0], p.vel[2]) || 1
        const bx = (p.vel[0] / planarSpd)
        const bz = (p.vel[2] / planarSpd)
        const brake = (P.TURN_BRAKE || 14.0) * dt
        // Do not overshoot past zero
        const mag = Math.min(planarSpd, brake)
        p.vel[0] -= bx * mag
        p.vel[2] -= bz * mag
      }
    }

    const spd = Math.hypot(p.vel[0], p.vel[2])
    if (spd > maxSpeed) {
      const s = maxSpeed / spd
      p.vel[0] *= s
      p.vel[2] *= s
    }

    // Ground friction (skip while sliding to preserve momentum; slide has its own friction)
    if (p.onGround && p.mode !== 'slide') {
      const baseFriction = P.FRICTION
      const frictionMul = isSprinting ? 0.6 : 1.0
      const friction = (wishLen > 0.01 ? baseFriction * 0.5 : baseFriction) * frictionMul * dt
      p.vel[0] *= Math.max(0, 1 - friction)
      p.vel[2] *= Math.max(0, 1 - friction)
    }

    // Jump press (edge) with opportunistic mantle including brief coyote-time in air
    // Ability activation (edge) before jump-dependent mechanics so grapple can override movement early
    const canUseAbility = room.gameMode !== 'noAbility' && (room.gameMode === 'runners' || room.itId === p.id)
    if (canUseAbility) {
      const abilityEdge = !!inp.ability && !p._abilityHold
      if (abilityEdge) {
        if (p.itAbility === 'dash' && p.itDashCd <= 0) {
          p.itDashT = IT.DASH_TIME || 0.8
          p.itDashCd = IT.DASH_COOLDOWN || 6
          // Small forward impulse
          const fwImp = [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)]
          // Stronger immediate impulse for dash to make it feel more powerful
          // Use configured dash speed multiplier so the instantaneous impulse matches the sustained dash boost
          const dashImpulse = P.MAX_SPEED * (IT.DASH_SPEED_MULT || 1.9)
          p.vel[0] += fwImp[0] * dashImpulse
          p.vel[2] += fwImp[2] * dashImpulse
          io.to(room.code).emit('sfx', { kind: 'slide', id: p.id })
        } else if (p.itAbility === 'grapple' && p.itGrappleCd <= 0) {
          // Shoot a ray from the player's view (using yaw/pitch) and set grapple target to the first hit point
          const dir = [
            -Math.sin(p.yaw) * Math.cos(p.pitch),
            Math.sin(p.pitch),
            -Math.cos(p.yaw) * Math.cos(p.pitch)
          ]
          // Use eye height for ray origin so server ray matches client camera-based preview
          const eyeH = (P.EYE_HEIGHT || (P.HEIGHT * 0.55))
          const origin = [p.pos[0], p.pos[1] + eyeH, p.pos[2]]
          const range = IT.GRAPPLE_RANGE || 30
          // ray-AABB intersection (slab method). Returns t (distance along dir) or null
          function rayAABB(orig, d, aabb) {
            let tmin = -Infinity, tmax = Infinity
            for (let i = 0; i < 3; i++) {
              const o = orig[i], di = d[i]
              const min = aabb.min[i], max = aabb.max[i]
              if (Math.abs(di) < 1e-6) {
                if (o < min || o > max) return null
                continue
              }
              let t1 = (min - o) / di
              let t2 = (max - o) / di
              if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
              if (t1 > tmin) tmin = t1
              if (t2 < tmax) tmax = t2
              if (tmin > tmax) return null
            }
            if (tmax < 0) return null
            const t = tmin >= 0 ? tmin : tmax
            return t
          }
          let bestT = Infinity
          let bestPoint = null
          for (const b of mapData.aabbs) {
            const t = rayAABB(origin, dir, b)
            if (t !== null && t <= range && t < bestT) {
              bestT = t
              bestPoint = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t]
            }
          }
          if (bestPoint) {
            p.itGrappleTarget = bestPoint
            p.itGrappleActive = true
            p.itGrappleCd = IT.GRAPPLE_COOLDOWN || 8
            io.to(room.code).emit('sfx', { kind: 'wallrun', id: p.id })
          }
        }
      }
      p._abilityHold = !!inp.ability
      // Tick dash timer & cooldowns
      if (p.itDashT > 0) p.itDashT = Math.max(0, p.itDashT - dt)
      if (p.itDashCd > 0) p.itDashCd = Math.max(0, p.itDashCd - dt)
      if (p.itGrappleCd > 0) p.itGrappleCd = Math.max(0, p.itGrappleCd - dt)
      if (p.itGrappleActive && p.itGrappleTarget) {
        const tgt = p.itGrappleTarget
        const to = [tgt[0] - p.pos[0], tgt[1] - p.pos[1], tgt[2] - p.pos[2]]
        const dist = Math.hypot(to[0], to[1], to[2]) || 1
        const pullSpd = (IT.GRAPPLE_PULL_SPEED || 25)
        const step = Math.min(pullSpd * dt, dist)
        // Override velocity toward target (grapple is authoritative movement)
        p.vel[0] = to[0] / dist * pullSpd
        p.vel[1] = to[1] / dist * pullSpd
        p.vel[2] = to[2] / dist * pullSpd
        // End near target or if very close horizontally
        if (dist < 1.2) {
          p.itGrappleActive = false
          p.itGrappleTarget = null
          p.chainT = Math.max(p.chainT || 0, (P.CHAIN_TIME || 0.45))
          p.chainStacks = Math.min((P.CHAIN_MAX_STACKS || 5), (p.chainStacks || 0) + 1)
          io.to(room.code).emit('sfx', { kind: 'jump', id: p.id })
        }
        // Abort if progress stalls (distance not decreasing significantly) or timeout exceeded
        p._grapplePrevDist = (typeof p._grapplePrevDist === 'number') ? p._grapplePrevDist : dist + 0.01
        p._grappleElapsed = (p._grappleElapsed || 0) + dt
        const improving = p._grapplePrevDist - dist
        if (p._grappleElapsed > (IT.GRAPPLE_MAX_TIME || 2.5) || improving < 0.02) {
          // allow a short grace if still fairly far but barely moving
          if (p._grappleElapsed > (IT.GRAPPLE_MAX_TIME || 2.5) || dist > 3 && improving < 0.02) {
            p.itGrappleActive = false
            p.itGrappleTarget = null
            io.to(room.code).emit('sfx', { kind: 'slide', id: p.id })
          }
        }
        p._grapplePrevDist = dist
      }
    }
    let mantleSfx = null
    const jumpPressEdge = !!inp.jump && !p.wasHoldingJump
    if (jumpPressEdge) {
      // set buffer timer
      p.jumpBufferedT = P.JUMP_BUFFER
      const canMantle = p.onGround || ((p.airSince || 0) < 0.25)
      if (canMantle) mantleSfx = tryMantle(p, mapData)
      // Tic-tac attempt (air, near wall, not wallrunning)
      if (!p.onGround && !mantleSfx && p.tictacCd <= 0) {
        const hit = nearestWall(p, mapData)
        if (hit && p.mode !== 'wallrunL' && p.mode !== 'wallrunR') {
          // Make tic-tac more forgiving and snappy:
          // - bias more outward so player is pushed away from the wall
          // - scale horizontal impulse with current forward velocity
          // - give a stronger vertical boost
          const along = norm3(cross([0,1,0], hit.normal))
          const fw = [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)]
          const outward = mul3(hit.normal, -1)
          // prefer outward + along, but allow player's facing to nudge direction
          let dir = norm3([
            outward[0] * 0.72 + along[0] * 0.22 + fw[0] * 0.06,
            0,
            outward[2] * 0.72 + along[2] * 0.22 + fw[2] * 0.06
          ])
          // Base force boosted for better responsiveness
          const baseForce = (P.WALLJUMP_FORCE || 8.5) * 0.9
          // Preserve planar component proportionally so we don't stomp momentum
          const planarBefore = [p.vel[0], 0, p.vel[2]]
          const preservedAlong = dot3(planarBefore, dir)
          // Blend preserved forward with outward impulse
          const blendPreserve = Math.max(0, Math.min(1, preservedAlong / Math.max(1, P.MAX_SPEED)))
          const finalPlanar = [
            dir[0] * baseForce * (0.8 + 0.2 * blendPreserve) + planarBefore[0] * (0.2 * blendPreserve),
            0,
            dir[2] * baseForce * (0.8 + 0.2 * blendPreserve) + planarBefore[2] * (0.2 * blendPreserve)
          ]
          p.vel[0] = finalPlanar[0]
          p.vel[2] = finalPlanar[2]
          // Stronger vertical boost to make tictac feel snappy
          p.vel[1] = Math.max(p.vel[1], P.JUMP_VELOCITY * 0.92)
          // Slight nudge away to avoid re-collision
          p.pos[0] += dir[0] * 0.03
          p.pos[2] += dir[2] * 0.03
          // Refresh chain window when successfully tic-tacing
          p.chainT = Math.max(p.chainT || 0, (P.CHAIN_TIME || 0.45))
          p.chainStacks = Math.min((P.CHAIN_MAX_STACKS || 5), (p.chainStacks || 0) + 1)
          // Slightly shorter cooldown so players can string tics more reliably
          p.tictacCd = (P.TICTAC_COOLDOWN || 0.28) * 0.85
          io.to(room.code).emit('sfx', { kind: 'tictac', id: p.id })
          // consume jump buffer
          p.jumpBufferedT = 0
        }
      }
    }

    // Consume buffered jump if allowed (ground or coyote)
    if ((p.onGround || (p.airSince || 0) <= P.COYOTE_TIME) && p.jumpBufferedT > 0 && !mantleSfx) {
      // Block jumping if there isn't enough headroom to stand
      if (!canStandUp(p, mapData, 0.08)) {
        // Keep buffer briefly so the player can jump right after clearing headroom
        // but avoid infinite buffering; we already decay jumpBufferedT below
      } else {
      p.jumpBufferedT = 0
      p.vel[1] = P.JUMP_VELOCITY
      p.onGround = false
      io.to(room.code).emit('sfx', { kind: 'jump', id: p.id })
      }
    }

    // Start slide if criteria met
    if (p.onGround) {
      const planar = Math.hypot(p.vel[0], p.vel[2])
      if (inp.crouch && planar >= P.SLIDE_SPEED_MIN && p.mode !== 'slide' && (p.slideCd || 0) <= 0) {
        const slideHeight = Math.max(1.0, P.HEIGHT - 0.6)
        const clearance = overheadClearance(p, mapData)
        // Require enough space above feet for slide body (avoid sliding into tiny gaps)
        if (clearance === Infinity || clearance >= (P.MIN_SLIDE_CLEARANCE || slideHeight + 0.05)) {
          p.mode = 'slide'
          p.slideT = P.SLIDE_DURATION
          // Starting a slide counts toward chaining
          p.chainT = Math.max(p.chainT || 0, (P.CHAIN_TIME || 0.5))
          p.chainStacks = Math.min((P.CHAIN_MAX_STACKS || 5), (p.chainStacks || 0) + 1)
          io.to(room.code).emit('sfx', { kind: 'slide', id: p.id })
        } else {
          // Not enough clearance: enter crouch instead
          p.mode = 'crouch'
        }
      }
    }
    if (p.mode === 'slide') {
      // Slide hop: jump press while sliding gives a small pop and extends chain
      if (jumpPressEdge && p.onGround) {
        const fwHop = [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)]
        const hopF = (P.SLIDE_HOP_FORCE || 2.0)
        // Preserve forward speed and add a touch of forward impulse
        const planar = [p.vel[0], 0, p.vel[2]]
        const along = (planar[0]*fwHop[0] + planar[2]*fwHop[2])
        const addForward = Math.max(0.6, Math.min(1.0, along / Math.max(1, P.MAX_SPEED))) * (hopF * 0.35)
        p.vel[0] = planar[0] + fwHop[0] * addForward
        p.vel[2] = planar[2] + fwHop[2] * addForward
        p.vel[1] = Math.max(p.vel[1], hopF)
        p.onGround = false
        p.mode = 'air'
        p.slideT = 0
        p.slideCd = Math.max(p.slideCd || 0, (P.SLIDE_COOLDOWN || 0.7))
  p.chainT = Math.max(p.chainT || 0, (P.CHAIN_TIME || 0.5))
  p.chainStacks = Math.min((P.CHAIN_MAX_STACKS || 5), (p.chainStacks || 0) + 1)
        io.to(room.code).emit('sfx', { kind: 'jump', id: p.id })
      }
      p.slideT -= dt
      // Lower friction while sliding to keep speed; slide friction only applies when grounded
      const fr = Math.max(0, (P.SLIDE_FRICTION || 3.0) * dt)
      p.vel[0] *= Math.max(0, 1 - fr)
      p.vel[2] *= Math.max(0, 1 - fr)
      // Abort slide if clearance becomes too small (e.g. moving under a very low overhang)
      const slideHeight = Math.max(1.0, P.HEIGHT - 0.6)
      const clearance = overheadClearance(p, mapData)
      const crouchNeed = (P.CROUCH_HEIGHT || (P.HEIGHT - 0.25)) + 0.05
      // If space is even lower than crouch height, force staying in slide and keep a small remaining timer to avoid popping
      if (clearance !== Infinity && clearance < crouchNeed) {
        p.slideT = Math.max(p.slideT, 0.12)
      } else if (clearance !== Infinity && clearance < (P.MIN_SLIDE_CLEARANCE || slideHeight + 0.05)) {
        p.mode = 'crouch'
        p.slideT = 0
        p.slideCd = Math.max(p.slideCd || 0, (P.SLIDE_COOLDOWN || 0.7))
      }
      // Try to exit slide if conditions say so, but only if there is headroom to stand
      const wantExit = (!p.onGround || !inp.crouch || p.slideT <= 0)
      if (wantExit) {
        if (canStandUp(p, mapData, 0.08)) {
          p.mode = p.onGround ? 'ground' : 'air'
          p.slideCd = Math.max(p.slideCd || 0, (P.SLIDE_COOLDOWN || 0.7))
        } else {
          // Transition into crouch (slow walk) if blocked overhead after slide
          p.mode = 'crouch'
          p.slideCd = Math.max(p.slideCd || 0, (P.SLIDE_COOLDOWN || 0.7))
          p.crouchSince = (p.crouchSince || 0) + dt
        }
      }
    }
    // Handle crouch persistence & speed penalty
  if (p.mode === 'crouch') {
      // Apply movement speed reduction
      const crouchMult = P.CROUCH_SPEED_MULT || 0.55
      const planarSpd = Math.hypot(p.vel[0], p.vel[2])
      const maxCrouch = (P.MAX_SPEED * crouchMult)
      if (planarSpd > maxCrouch) {
        const s = maxCrouch / planarSpd; p.vel[0] *= s; p.vel[2] *= s
      }
      // Exit crouch automatically when head clearance returns
      if (canStandUp(p, mapData, 0.1) && !inp.crouch) {
        p.mode = p.onGround ? 'ground' : 'air'
        p.crouchSince = 0
      }
      // If player presses jump while crouched and there is clearance, allow jump (handled later by jump buffer logic)
    }

    // Gravity baseline
    p.vel[1] -= P.GRAVITY * dt

    // Integrate
    p.pos[0] += p.vel[0] * dt
    p.pos[1] += p.vel[1] * dt
    p.pos[2] += p.vel[2] * dt

    // Collisions & ground
    resolveCollisions(p, mapData)

  // Air timer & decay timers
  if (p.onGround) p.airSince = 0
  else p.airSince = (p.airSince || 0) + dt
  p.jumpBufferedT = Math.max(0, p.jumpBufferedT - dt)
  p.tictacCd = Math.max(0, (p.tictacCd || 0) - dt)
  p.slideCd = Math.max(0, (p.slideCd || 0) - dt)
    p.chainT = Math.max(0, (p.chainT || 0) - dt)
    // Decay fractional chain stacks over time so players must keep chaining to maintain bonus
    p.chainStacks = Math.max(0, (p.chainStacks || 0) - (dt / (P.CHAIN_STACK_DECAY || 3.0)))

    // Allow mantling while falling: if holding jump and moving downward near a ledge, attempt a catch
    // This makes catching an edge while dropping easier than the short jump-edge coyote window
    if (!p.onGround && p.vel[1] < -0.5 && inp.jump) {
      const mantleSfxFall = tryMantle(p, mapData)
      if (mantleSfxFall) {
        io.to(room.code).emit('sfx', { kind: mantleSfxFall, id: p.id })
        // Enter mantle state immediately; skip wallrun/other processing this tick
        continue
      }
    }

    // Wallrun (can override mode/vel)
  const sfx = doWallrun(p, inp, dt, mapData)

    // Default mode if not in a special state
    if (p.onGround) {
      if (!['mantle', 'slide', 'wallrunL', 'wallrunR', 'crouch'].includes(p.mode)) p.mode = 'ground'
    } else {
      if (!['mantle', 'slide', 'wallrunL', 'wallrunR', 'crouch'].includes(p.mode)) p.mode = 'air'
    }

    if (mantleSfx) io.to(room.code).emit('sfx', { kind: mantleSfx, id: p.id })
    if (sfx) io.to(room.code).emit('sfx', { kind: sfx, id: p.id })
    // track jump edge for wall-jump detection
    p.wasHoldingJump = !!inp.jump

    // Respawn if fallen below kill plane
    if (p.pos[1] < -40) {
      // Choose a random spawn when respawning (avoid predictable clustering)
      const sp = mapData.spawnPoints[Math.floor(Math.random() * mapData.spawnPoints.length)]
      const spawn = [sp[0], sp[1], sp[2]]
      p.pos = [spawn[0], spawn[1], spawn[2]]
      p.vel = [0, 0, 0]
      p.mode = 'air'
      p.onGround = false
      p.airSince = 0
      p._wallrunBoostUsed = false
      p.mantleT = 0; p.mantleFromY = 0; p.mantleToY = 0
      io.to(room.code).emit('sfx', { kind: 'land', id: p.id })
    }
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
      onGround: !!p.onGround, mode: p.mode,
  chainT: p.chainT,
  chainStacks: p.chainStacks || 0,
      itAbility: p.itAbility,
      itDashT: p.itDashT, itDashCd: p.itDashCd,
    itGrappleActive: p.itGrappleActive, itGrappleCd: p.itGrappleCd,
  itGrappleTarget: (p.itGrappleActive && p.itGrappleTarget) ? (Array.isArray(p.itGrappleTarget) ? { x: p.itGrappleTarget[0], y: p.itGrappleTarget[1], z: p.itGrappleTarget[2] } : p.itGrappleTarget) : null,
      color: p.color,
      face: p.face,
      hat: p.hat,
      // Omit heavy `faceData` (user-provided image) from per-tick snapshots to save bandwidth.
      // faceData is sent via lobby/profile updates when it changes.
      faceData: null
    })),
    itId: room.itId,
    roundTime: room.intermission ? room.intermissionTime : room.roundTime,
    intermission: room.intermission,
    mapName: room.mapName,
    gameMode: room.gameMode || 'default',
    scores: room.scores,
    state: room.state,
    // Provide maps during any intermission (pre-vote and between rounds) so client can render voting UI.
    maps: room.intermission ? mapList.options : undefined
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
    p._wallrunBoostUsed = false
    p.mantleT = 0; p.mantleFromY = 0; p.mantleToY = 0
  })
  // Reset scores every round
  room.scores = {}
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

function startPreVote(code) {
  const room = rooms[code]
  if (!room) return
  if (room.loop) clearInterval(room.loop)
  // Use intermission fields to drive the countdown and reuse client UI
  room.state = 'preVote'
  room.results = null
  room.intermission = true
  room.intermissionTime = (typeof TAG.INTERMISSION_SECONDS === 'number' ? TAG.INTERMISSION_SECONDS : 10)
  // Switch clients to game screen where MapVote is shown during intermission
  io.to(code).emit('game:started')
  room.loop = setInterval(() => {
    const dt = DT
    room.intermissionTime -= dt
    if (room.intermissionTime <= 0) {
      room.intermission = false
      // Apply votes and lock pre-vote
      chooseNextMap(room)
      room.voting = false
      // Transition into normal game loop
      clearInterval(room.loop)
      room.loop = null
      startLoop(code)
      return
    }
    io.to(code).emit('world:snapshot', snapshot(room))
    // live vote tally is emitted on each vote: no need to emit here
  }, 1000 * DT)
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
        io.to(code).emit('game:started')
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

  socket.on('room:create', ({ name, gameMode }) => {
    let code = makeCode()
    while (rooms[code]) code = makeCode()
    const mapName = mapList.default
    rooms[code] = {
      code,
      hostId: socket.id,
      state: 'lobby',
      players: {},
      itId: null,
      prevItId: null,
      tagCooldown: 0,
      roundTime: 0,
      intermission: false,
      intermissionTime: 0,
      loop: null,
      mapName,
      mapData: loadMap(mapName),
      scores: {},
      results: null,
      votes: {},
      voting: true, // enable pre-game voting
  gameMode: (gameMode === 'default' || gameMode === 'noAbility' || gameMode === 'dark' || gameMode === 'runners') ? gameMode : 'default'
    }
    socket.join(code); joinedCode = code
    rooms[code].players[socket.id] = makePlayer(socket.id, name || 'Runner')
    for (const s of Object.keys(rooms[code].players)) {
      io.to(s).emit('lobby:update', { roomCode: code, players: listSummaries(rooms[code]), maps: mapList.options, mapName, gameMode: rooms[code].gameMode })
    }
  })

  socket.on('room:join', ({ code, name }) => {
    code = String(code || '').toUpperCase()
    const room = rooms[code]
    if (!room) { socket.emit('error', 'Room not found'); return }
  socket.join(code); joinedCode = code
  room.players[socket.id] = makePlayer(socket.id, name || 'Runner')
    // Ensure scoreboard shows the new player immediately
    room.scores[socket.id] = room.scores[socket.id] || 0
    for (const s of Object.keys(room.players)) {
      io.to(s).emit('lobby:update', { roomCode: code, players: listSummaries(room), maps: mapList.options, mapName: room.mapName, gameMode: room.gameMode })
    }
  })

  socket.on('lobby:ready', ({ ready }) => {
    if (!joinedCode) return
    const room = rooms[joinedCode]
    const p = room?.players?.[socket.id]; if (!p) return
    p.ready = !!ready
    for (const s of Object.keys(room.players)) {
      io.to(s).emit('lobby:update', { roomCode: joinedCode, players: listSummaries(room), maps: mapList.options, mapName: room.mapName, gameMode: room.gameMode })
    }
  })

  // Host may change the game mode while in the lobby. Broadcast to all players.
  socket.on('room:setMode', ({ gameMode }) => {
    if (!joinedCode) return
    const room = rooms[joinedCode]
    if (!room) return
    if (socket.id !== room.hostId) return
    if (gameMode === 'default' || gameMode === 'noAbility' || gameMode === 'dark' || gameMode === 'runners') {
      room.gameMode = gameMode
      for (const s of Object.keys(room.players)) {
        io.to(s).emit('lobby:update', { roomCode: joinedCode, players: listSummaries(room), maps: mapList.options, mapName: room.mapName, gameMode: room.gameMode })
      }
    }
  })

  socket.on('game:start', () => {
    if (!joinedCode) return
    const room = rooms[joinedCode]
    if (!room) return
    if (socket.id !== room.hostId) return
    const readyCount = Object.values(room.players).filter(p => p.ready).length
    if (readyCount < Math.max(1, MIN_PLAYERS)) {
      io.to(socket.id).emit('game:startFailed', { reason: `Need at least ${MIN_PLAYERS} ready player(s) to start`, readyCount, min: MIN_PLAYERS })
      return
    }
    // If pre-game voting is desired, start a short vote phase before round 1
    if (room.voting) {
      return startPreVote(joinedCode)
    }
    startLoop(joinedCode)
  })

  socket.on('vote:map', ({ name }) => {
    if (!joinedCode) return
    const room = rooms[joinedCode]
    if (!room) return
    if (!mapList.options.includes(name)) return
    room.votes[socket.id] = name
    io.to(joinedCode).emit('vote:update', { votes: room.votes })
  })

  socket.on('player:update', ({ name, color, face, hat, faceData, itAbility }) => {
    if (!joinedCode) return
    const room = rooms[joinedCode]; if (!room) return
    const p = room.players[socket.id]; if (!p) return
    if (typeof name === 'string' && name.trim()) p.name = name.trim().slice(0, 24)
    if (typeof color === 'string' && /^#([0-9a-fA-F]{6})$/.test(color)) p.color = color
  const faces = new Set(['smile'])
  const hats = new Set(['none','cone','halo','glasses','shades','headphones','bandana','visor','mask'])
    if (typeof face === 'string' && faces.has(face)) p.face = face
    if (typeof hat === 'string' && hats.has(hat)) p.hat = hat
    if (typeof faceData === 'string' && faceData.startsWith('data:image/png;base64,')) {
      // Accept only reasonably-sized images (>2KB and <100KB) to avoid tiny 1px spam and huge payloads
      if (faceData.length > 2000 && faceData.length < 140000) p.faceData = faceData
      else if (faceData.length <= 2000) p.faceData = null
    }
  if (itAbility === 'dash' || itAbility === 'grapple' || itAbility === 'none') p.itAbility = itAbility
    // reflect to lobby
    for (const s of Object.keys(room.players)) {
      io.to(s).emit('lobby:update', { roomCode: joinedCode, players: listSummaries(room), maps: mapList.options, mapName: room.mapName, gameMode: room.gameMode })
    }
  })

  socket.on('input', (input) => {
    if (!joinedCode) return
    const room = rooms[joinedCode]
    const p = room?.players?.[socket.id]; if (!p) return
    // Historical forward/back mapping was inverted; keep compatibility:
    p.input = {
      forward: !!input.back, back: !!input.forward, left: !!input.left, right: !!input.right,
      jump: !!input.jump, sprint: !!input.sprint, crouch: !!input.crouch,
      ability: !!input.ability,
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
