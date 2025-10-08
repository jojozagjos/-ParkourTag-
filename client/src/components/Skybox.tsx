import React, { useMemo } from 'react'
import * as THREE from 'three'

export default function Skybox({ size = 800 }:{ size?: number }) {
  // Colors for the 6 faces: +X, -X, +Y, -Y, +Z, -Z
  const colors = useMemo(() => [
    '#87ceeb', // right - sky blue
    '#87ceeb', // left
    '#bfe9ff', // top - lighter
    '#6aa7d8', // bottom - darker horizon
    '#85c1ff', // front
    '#85c1ff'  // back
  ], [])

  const materials = useMemo(() => colors.map(c => new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide, depthWrite: false })), [colors])

  return (
    // @ts-ignore react-three-fiber will accept a materials array on the mesh
    <mesh material={materials}>
      <boxGeometry args={[size, size, size]} />
    </mesh>
  )
}
