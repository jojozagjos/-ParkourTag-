import { useEffect, useRef } from 'react'
import type { Socket } from 'socket.io-client'
import type { InputState } from '../types'

/**
 * First-person controls with pointer lock and full movement input,
 * including crouch for slide. Emits compact input payloads to the server.
 */
export function useFPControls(socket: Socket) {
  const input = useRef<InputState>({
    forward: false, back: false, left: false, right: false,
    jump: false, sprint: false, crouch: false,
    yaw: 0, pitch: 0
  })

  const sens = 0.0025
  const pitchClamp = Math.PI / 2 * 0.95

  useEffect(() => {
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (e.repeat) return
      switch (e.code) {
        case 'KeyW': case 'ArrowUp':     input.current.forward = down; break
        case 'KeyS': case 'ArrowDown':   input.current.back = down; break
        case 'KeyA': case 'ArrowLeft':   input.current.left = down; break
        case 'KeyD': case 'ArrowRight':  input.current.right = down; break
        case 'Space':                    input.current.jump = down; break
        case 'ShiftLeft': case 'ShiftRight': input.current.sprint = down; break
        case 'ControlLeft': case 'ControlRight': input.current.crouch = down; break
        default: return
      }
      socket.emit('input', { ...input.current })
    }

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== document.body) return
      // Invert horizontal movement so moving mouse right increases yaw positively
      input.current.yaw -= e.movementX * sens
      input.current.pitch -= e.movementY * sens
      if (input.current.pitch > pitchClamp) input.current.pitch = pitchClamp
      if (input.current.pitch < -pitchClamp) input.current.pitch = -pitchClamp
      socket.emit('input', { ...input.current })
    }

    const requestLock = () => {
      if (!document.pointerLockElement) {
        const el = document.body as any
        el.requestPointerLock?.()
      }
    }

    const keyDown = (e: KeyboardEvent) => onKey(e, true)
    const keyUp   = (e: KeyboardEvent) => onKey(e, false)

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('click', requestLock)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('click', requestLock)
    }
  }, [socket])

  return input
}
