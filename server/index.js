const express = require('express')
const http = require('http')
const cors = require('cors')
const { Server } = require('socket.io')
const constants = require('../shared/constants.json')
const mapList = require('../shared/maps/index.json')
const fs = require('fs')
const path = require('path')

const app = express()
app.use(cors())
// Development Content Security Policy: allow connections to localhost and websockets
app.use((req, res, next) => {
  // Development Content Security Policy: allow connections to localhost and websockets
  // NOTE: this is intentionally permissive for local development only. Do NOT enable in production.
  const connectSources = [
    "'self'",
    'http://localhost:3000',
    'http://localhost:3001',
    'https://localhost:3000',
    'https://localhost:3001',
    'ws://localhost:3001',
    'wss://localhost:3001',
    'ws:',
    'wss:',
    'http:',
    'https:'
  ].join(' ')
  const csp = `default-src 'self' 'unsafe-inline' data: blob:; connect-src ${connectSources}; img-src 'self' data:; frame-src 'self'`;
  res.setHeader('Content-Security-Policy', csp)
  next()
})

// Serve a small appspecific manifest used by some DevTools extensions under /.well-known
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  // Return a minimal 200 JSON so the browser/DevTools don't get a 404 (and then complain under CSP)
  res.json({ name: 'devtools-manifest', description: 'Local devtools helper', version: '1' })
})
// Root helps: show a small page with a link to the client dev server
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

// Load a map by name
function loadMap(name) {
  const p = path.join(__dirname, '..', 'shared', 'maps', `${name}.json`)
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

// --------------------- Utility ---------------------
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function aabbIntersect(a, b) {
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
         a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
         a.min[2] <= b.max[2] && a.max[2] >= b.min[2]
}
function len2(x, z) { return Math.hypot(x, z) }

const P = constants.PLAYER
const TAG = constants.TAG
const SCORE = constants.SCORE
const DT = constants.DT
// Minimum players required to start a game. Change to 2 to require at least 2 players.
const MIN_PLAYERS = process.env.MIN_PLAYERS ? Number(process.env.MIN_PLAYERS) : 1

// --------------------- Rooms -----------------------
/**
rooms: {
  CODE: {
    hostId: string,
    state: 'lobby' | 'playing' | 'ended',
    players: { [socketId]: Player },
    itId: string | null,
    tagCooldown: number,
    roundTime: number,
    intermission: boolean,
    intermissionTime: number,
    loop: NodeJS.Timer | null,
    // new:
    mapName: string,
    mapData: Map,
    scores: { [socketId]: number },
    results: { placement: Array<{id:string,name:string,score:number}> } | null,
    votes: { [socketId]: string | null }  // selected map per player
  }
}
*/
const rooms = {}

function makeCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}
function listSummaries(room) {
  return Object.values(room.players).map(p => ({ id: p.id, name: p.name, ready: p.ready, host: p.id === room.hostId }))
}

// ------------------ Physics/Collisions -------------
function makePlayer(id, name) {
  return {
    id, name, ready: false,
    pos: [0, 2.0, 0],
    vel: [0, 0, 0],
    yaw: 0, pitch: 0,
    onGround: false,
    mode: 'air',
    slideT: 0,
    wallRunT: 0,
    wallSide: 0,
    mantleT: 0,
    input: { forward:false,back:false,left:false,right:false,jump:false,sprint:false,crouch:false,yaw:0,pitch:0 }
  }
}
function expandAABBForCapsule(aabb) {
  return {
    min: [aabb.min[0] - P.RADIUS, aabb.min[1], aabb.min[2] - P.RADIUS],
    max: [aabb.max[0] + P.RADIUS, aabb.max[1], aabb.max[2] + P.RADIUS]
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
    const e = expandAABBForCapsule(b)
    if (!aabbIntersect(aabb, { min: [e.min[0], b.min[1], e.min[2]], max: [e.max[0], b.max[1], e.max[2]] })) continue
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
      aabb.min[1] = player.pos[1]
      aabb.max[1] = player.pos[1] + height
    } else if (px < pz) {
      if (dx1 < dx2) {
        player.pos[0] += dx1 + 1e-6
        if (player.vel[0] < 0) player.vel[0] = 0
      } else {
        player.pos[0] -= dx2 + 1e-6
        if (player.vel[0] > 0) player.vel[0] = 0
      }
      aabb.min[0] = player.pos[0] - P.RADIUS
      aabb.max[0] = player.pos[0] + P.RADIUS
    } else {
      if (dz1 < dz2) {
        player.pos[2] += dz1 + 1e-6
        if (player.vel[2] < 0) player.vel[2] = 0
      } else {
        player.pos[2] -= dz2 + 1e-6
        if (player.vel[2] > 0) player.vel[2] = 0
      }
      aabb.min[2] = player.pos[2] - P.RADIUS
      aabb.max[2] = player.pos[2] + P.RADIUS
    }
  }
  player.onGround = onGround
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
    // client SFX cue
    return 'mantle'
  }
  return null
}
function tryStartWallRun(player, mapData) {
  if (player.onGround || player.vel[1] <= -0.5) return null
  const offsets = [
    { side: -1, axis: 'x', dx: -P.RADIUS - 0.05, dz: 0 },
    { side: +1, axis: 'x', dx: +P.RADIUS + 0.05, dz: 0 },
    { side: -1, axis: 'z', dx: 0, dz: -P.RADIUS - 0.05 },
    { side: +1, axis: 'z', dx: 0, dz: +P.RADIUS + 0.05 }
  ]
  const height = P.HEIGHT * 0.6
  for (const off of offsets) {
    const probe = {
      min: [player.pos[0] + off.dx - 0.05, player.pos[1] + 0.3, player.pos[2] + off.dz - 0.05],
      max: [player.pos[0] + off.dx + 0.05, player.pos[1] + height, player.pos[2] + off.dz + 0.05]
    }
    for (const b of mapData.aabbs) {
      if (aabbIntersect(probe, b)) {
        player.wallRunT = P.WALLRUN_DURATION
        player.wallSide = (off.axis === 'x' ? (off.dx < 0 ? -1 : 1) : (off.dz < 0 ? -1 : 1))
        player.mode = player.wallSide < 0 ? 'wallrunL' : 'wallrunR'
        if (off.axis === 'x') player.vel[0] = 0; else player.vel[2] = 0
        return 'wallrun'
      }
    }
  }
  return null
}

function pickSpawn(mapData, i) {
  const sp = mapData.spawnPoints[i % mapData.spawnPoints.length]
  return [sp[0], sp[1], sp[2]]
}

function selectInitialIt(room) {
  const ids = Object.keys(room.players)
  room.itId = ids.length ? ids[Math.floor(Math.random()*ids.length)] : null
  room.tagCooldown = TAG.COOLDOWN
}

function physicsStep(room, dt) {
  const mapData = room.mapData;
  for (const p of Object.values(room.players)) {
    const inp = p.input;
    p.yaw = typeof inp.yaw === 'number' ? inp.yaw : p.yaw;
    p.pitch = clamp(typeof inp.pitch === 'number' ? inp.pitch : p.pitch, -Math.PI / 2 * 0.95, Math.PI / 2 * 0.95);

    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const fw = [sin, 0, cos];
    const rt = [cos, 0, -sin];

    let wishX = 0, wishZ = 0;
    if (inp.forward) { wishX += fw[0]; wishZ += fw[2]; }
    if (inp.back)    { wishX -= fw[0]; wishZ -= fw[2]; }
    if (inp.left)    { wishX -= rt[0]; wishZ -= rt[2]; }
    if (inp.right)   { wishX += rt[0]; wishZ += rt[2]; }
    const wishLen = Math.hypot(wishX, wishZ) || 1;
    wishX /= wishLen; wishZ /= wishLen;

    // Sprint only applies when on ground and holding forward
    const isSprinting = p.onGround && !!inp.sprint && !!inp.forward;
    const accelBase = p.onGround ? P.MOVE_ACCEL : P.AIR_ACCEL;
    // Give sprint higher acceleration so speed ramps up faster
    const accel = accelBase * (isSprinting ? 1.5 : 1.0);
    const maxSpeed = isSprinting ? P.MAX_SPEED * P.SPRINT_MULT : P.MAX_SPEED;

    p.vel[0] += wishX * accel * dt;
    p.vel[2] += wishZ * accel * dt;

    const sp = Math.hypot(p.vel[0], p.vel[2]);
    if (sp > maxSpeed) {
      const s = maxSpeed / sp;
      p.vel[0] *= s;
      p.vel[2] *= s;
    }

    // Apply friction when on the ground (reduce friction while sprinting to maintain momentum)
    if (p.onGround) {
      const baseFriction = P.FRICTION;
      const frictionMul = isSprinting ? 0.6 : 1.0;
      const friction = (wishLen > 0.01 ? baseFriction * 0.5 : baseFriction) * frictionMul * dt;
      p.vel[0] *= Math.max(0, 1 - friction);
      p.vel[2] *= Math.max(0, 1 - friction);
    }

    if (inp.jump && p.onGround) {
      p.vel[1] = P.JUMP_VELOCITY;
      p.onGround = false;
    } else {
      p.vel[1] -= P.GRAVITY * dt;
    }

    p.pos[0] += p.vel[0] * dt;
    p.pos[1] += p.vel[1] * dt;
    p.pos[2] += p.vel[2] * dt;

    resolveCollisions(p, mapData);
  // Debug logs removed
  }
}

function accumulateScores(room, dt) {
  // Everyone not IT gets survival score per second
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
      // Award IT and transfer
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
      id: p.id, name: p.name, pos: p.pos, vel: p.vel, yaw: p.yaw, pitch: p.pitch, mode: p.mode
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
  })
  room.roundTime = TAG.ROUND_SECONDS
  room.intermission = false
  room.intermissionTime = 0
  room.results = null
  selectInitialIt(room)
}

function finishRound(room) {
  // Prepare results
  const placement = Object.keys(room.players)
    .map(id => ({ id, name: room.players[id].name, score: Math.round(room.scores[id] || 0) }))
    .sort((a, b) => b.score - a.score)
  room.results = { placement }
  io.to(room.code).emit('round:results', room.results)
  room.intermission = true
  room.intermissionTime = TAG.INTERMISSION_SECONDS
  // Reset votes for map voting
  room.votes = {}
}

function chooseNextMap(room) {
  // Tally votes. If no votes, keep current.
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
  // Notify clients that the game has started
  console.log('[server] [startLoop] emitting game:started for', code)
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
  // Notify clients that the game has ended
  console.log('[server] [stopLoop] emitting game:ended for', code)
  io.to(code).emit('game:ended')
  room.loop = null
  room.state = 'ended'
}

// ------------------ Socket Handlers ----------------
io.on('connection', (socket) => {
  console.log('[io] client connected:', socket.id, 'handshake addr=', socket.handshake.address, 'headers=', Object.keys(socket.handshake.headers || {}).join(','))
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
    // Auto-mark host as ready so a single-player game can be started immediately
    // rooms[code].players[socket.id].ready = true
    // Lobby update
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
    console.log('[game:start] host', socket.id, 'room', joinedCode, 'hostId', room.hostId)
    if (socket.id !== room.hostId) {
      console.log('[game:start] rejected: not host')
      return
    }
    // Count how many players are ready
    const readyCount = Object.values(room.players).filter(p => p.ready).length
    console.log('[game:start] readyCount', readyCount, 'MIN_PLAYERS', MIN_PLAYERS)
    if (readyCount >= Math.max(1, MIN_PLAYERS)) {
      console.log('[game:start] starting loop for', joinedCode)
      startLoop(joinedCode)
    } else {
      console.log('[game:start] rejected: not enough ready players')
      // Inform host that not enough players are ready
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
    // NOTE: historically the client/server forward/back mapping was inverted.
    // Swap forward/back here so clients that send forward=true when pressing W behave correctly.
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
