import { useEffect, useRef } from 'react'
import type { Socket } from 'socket.io-client'
import type { InputState } from '../types'

export function useFPControls(socket: Socket) {
  const input = useRef<InputState>({
    forward: false, back: false, left: false, right: false,
    jump: false, sprint: false, crouch: false,
    yaw: 0, pitch: 0
  })
  const sens = 0.0025
  const pitchClamp = Math.PI/2 * 0.95

  useEffect(() => {
    function onKey(e: KeyboardEvent, down: boolean) {
      if (e.repeat) return
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': input.current.forward = down; break
        case 'KeyS': case 'ArrowDown': input.current.back = down; break
        case 'KeyA': case 'ArrowLeft': input.current.left = down; break
        case 'KeyD': case 'ArrowRight': input.current.right = down; break
        case 'Space': input.current.jump = down; break
        case 'ShiftLeft': case 'ShiftRight': input.current.sprint = down; break
        case 'ControlLeft': case 'ControlRight': input.current.crouch = down; break
      }
    // Emit a copy of the input state as-is (no forward/back swap). Server expects the client's forward to be true when moving forward.
    socket.emit('input', { ...input.current, forward: !!input.current.forward, back: !!input.current.back })
    }

    const keyDownHandler = (e: KeyboardEvent) => onKey(e, true)
    const keyUpHandler = (e: KeyboardEvent) => onKey(e, false)

    function mouseMoveHandler(e: MouseEvent) {
      // Accept any pointerLockElement; different browsers/elements may set it to the canvas
      if (!document.pointerLockElement) return
  // invert yaw sign so client yaw matches server/world coordinate conventions
  input.current.yaw -= e.movementX * sens
      input.current.pitch -= e.movementY * sens
      if (input.current.pitch > pitchClamp) input.current.pitch = pitchClamp
      if (input.current.pitch < -pitchClamp) input.current.pitch = -pitchClamp
    // Emit a copy of the input state as-is (no forward/back swap)
    socket.emit('input', { ...input.current, forward: !!input.current.forward, back: !!input.current.back })
    }

    function clickHandler(e: MouseEvent) {
      // Prefer locking the clicked element (commonly the canvas), fall back to body
      const el = (e.target && (e.target as HTMLElement)) || document.body
      if (!document.pointerLockElement && el.requestPointerLock) {
        try { el.requestPointerLock() } catch (err) { document.body.requestPointerLock && document.body.requestPointerLock() }
      }
    }

    window.addEventListener('keydown', keyDownHandler)
    window.addEventListener('keyup', keyUpHandler)
    window.addEventListener('mousemove', mouseMoveHandler)
    window.addEventListener('click', clickHandler)
    return () => {
      window.removeEventListener('keydown', keyDownHandler)
      window.removeEventListener('keyup', keyUpHandler)
      window.removeEventListener('mousemove', mouseMoveHandler)
      window.removeEventListener('click', clickHandler)
    }
  }, [socket])

  return input
}
