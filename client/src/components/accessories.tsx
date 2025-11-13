import React, { useMemo } from 'react'
import * as THREE from 'three'

export type AccessoryKind = 'none' | 'cone' | 'halo' | 'glasses' | 'shades' | 'headphones' | 'bandana' | 'visor' | 'mask'

/**
 * accessoryMesh
 * Returns a React element containing the accessory meshes for a given hat/accessory kind.
 * Coordinates:
 *  - eyeY: vertical eye level (player eye height world units)
 *  - faceY: vertical center of the face plane (used for glasses/mask placement)
 *  - variant: 'game' for in-world avatar, 'preview' for menu preview; preview may sit slightly higher.
 * All offsets are defined relative to eyeY to keep placements centralized.
 */
export function accessoryMesh(kind: AccessoryKind, eyeY: number, faceY: number, variant: 'game' | 'preview' = 'game') {
  if (kind === 'none') return null
  // Variant adjustment allows small vertical tweaks without duplicating definitions
  const lift = variant === 'preview' ? 0.02 : 0
  const headBase = eyeY + 0.18 + lift

  switch (kind) {
    // cap removed — use other accessories
    case 'cone':
      return (
        <mesh position={[0, headBase + 0.14, 0]} castShadow>
          <coneGeometry args={[0.32, 0.7, 16]} />
          <meshStandardMaterial color="#ffb347" roughness={0.5} metalness={0.1} />
        </mesh>
      )
    case 'halo':
      return (
        <mesh position={[0, headBase + 0.14, 0]} rotation={[Math.PI/2,0,0]}>
          <torusGeometry args={[0.42, 0.07, 16, 32]} />
          <meshStandardMaterial color="#ffe066" emissive="#ffea8a" emissiveIntensity={0.8} metalness={0.3} roughness={0.2} />
        </mesh>
      )
    case 'glasses':
      return (
        <group>
          <mesh position={[0.18, faceY + 0.06, -0.35]} castShadow>
            <torusGeometry args={[0.08, 0.02, 8, 24]} />
            <meshStandardMaterial color="#111" metalness={0.3} roughness={0.4} />
          </mesh>
          <mesh position={[-0.18, faceY + 0.06, -0.35]} castShadow>
            <torusGeometry args={[0.08, 0.02, 8, 24]} />
            <meshStandardMaterial color="#111" metalness={0.3} roughness={0.4} />
          </mesh>
          <mesh position={[0, faceY + 0.06, -0.35]} rotation={[0, 0, Math.PI/2]}>
            <cylinderGeometry args={[0.02, 0.02, 0.2, 6]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        </group>
      )
    case 'shades':
      return (
        <group>
          <mesh position={[0.18, faceY + 0.06, -0.36]} castShadow>
            <boxGeometry args={[0.23, 0.16, 0.02]} />
            <meshStandardMaterial color="#111" metalness={0.3} transparent opacity={0.75} />
          </mesh>
          <mesh position={[-0.18, faceY + 0.06, -0.36]} castShadow>
            <boxGeometry args={[0.23, 0.16, 0.02]} />
            <meshStandardMaterial color="#111" metalness={0.3} transparent opacity={0.75} />
          </mesh>
          <mesh position={[0, faceY + 0.06, -0.35]} rotation={[0, 0, Math.PI/2]}>
            <cylinderGeometry args={[0.02, 0.02, 0.2, 6]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        </group>
      )
    case 'headphones':
      return (
        <group>
          <mesh position={[0, headBase - 0.2, -0.05]} rotation={[Math.PI/1, 0, 0]}>
            <torusGeometry args={[0.4, 0.05, 4, 32]} />
            <meshStandardMaterial color="#222" metalness={0.2} roughness={0.4} />
          </mesh>
          <mesh position={[0.35, faceY + 0.02, -0.05]} castShadow>
            <sphereGeometry args={[0.20, 12, 8]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          <mesh position={[-0.35, faceY + 0.02, -0.05]} castShadow>
            <sphereGeometry args={[0.20, 12, 8]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        </group>
      )
    case 'bandana':
      return (
        // Render a small cube (box) instead of a cylinder for the bandana
        <mesh position={[0, headBase - 0.1, 0]} rotation={[0, 0, 0]} castShadow>
          <boxGeometry args={[0.73, 0.12, 0.73]} />
          <meshStandardMaterial color="#b91c1c" metalness={0.05} roughness={0.6} />
        </mesh>
      )
    case 'visor':
      return (
        <mesh position={[0, faceY + 0.12, -0.36]} castShadow>
          <boxGeometry args={[0.64, 0.16, 0.045]} />
          <meshStandardMaterial color="#9fd3ff" transparent opacity={0.75} emissive="#6fbff7" />
        </mesh>
      )
    case 'mask':
      return (
        <mesh position={[0, faceY - 0.13, 0]} castShadow>
          <boxGeometry args={[0.73, 0.22, 0.73]} />
          <meshStandardMaterial color="#101827" metalness={0.1} roughness={0.6} />
        </mesh>
      )
    default:
      return null
  }
}

export const ACCESSORY_OPTIONS: AccessoryKind[] = ['none','cone','halo','glasses','shades','headphones','bandana','visor','mask']

// HMR: notify the app when this module updates so components using useMemo can
// force a recompute of accessory meshes. Vite's React Fast Refresh may not
// re-run useMemo if inputs haven't changed, so we emit an event to force it.
if ((import.meta as any).hot) {
  ;(import.meta as any).hot.accept(() => {
    try {
      window.dispatchEvent(new CustomEvent('accessories:hmr'))
    } catch (e) {
      // Fallback to full reload if dispatching fails in an exotic env
      try { location.reload() } catch {}
    }
  })
}
