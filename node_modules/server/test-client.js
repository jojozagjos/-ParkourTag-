const { io } = require('socket.io-client')
const url = process.env.URL || 'http://localhost:3001'
console.log('test-client connecting to', url)
const s = io(url, { reconnectionAttempts: 3, timeout: 5000 })

s.on('connect', () => {
  console.log('connected', s.id)
  // create a room as host
  s.emit('room:create', { name: 'Tester' })
})

s.on('lobby:update', (p) => {
  console.log('lobby:update', JSON.stringify(p))
  // If we got a roomCode back (we're the host), try to start shortly after
  if (p?.roomCode) {
    setTimeout(() => {
      console.log('Attempting game:start')
      s.emit('game:start')
    }, 800)
  }
})

s.on('game:started', () => console.log('game:started'))
s.on('game:startFailed', (d) => console.log('game:startFailed', d))
s.on('round:results', r => console.log('round:results', r))
s.on('world:snapshot', snap => console.log('world:snapshot players=', (snap.players || []).length))

s.on('connect_error', (e) => console.log('connect_error', e && e.message))
s.on('error', (e) => console.log('error', e))
s.on('disconnect', () => console.log('disconnected'))

// safety: exit after 12s
setTimeout(() => { console.log('test-client exiting'); s.disconnect(); process.exit(0) }, 12000)
