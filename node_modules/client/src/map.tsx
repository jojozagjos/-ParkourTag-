import * as THREE from 'three'
import { useMemo } from 'react'
import { useLoader } from '@react-three/fiber'

// Load maps from shared/maps using Vite glob so the bundler can find them at build time
import mapIndex from '../../shared/maps/index.json'
const maps: Record<string, any> = {}
const ctx = import.meta.glob('../../shared/maps/*.json', { eager: true, query: '?json' }) as Record<string, any>
for (const k of Object.keys(ctx)) {
  // key will be like '../../shared/maps/ParkourYard.json'
  const name = k.split('/').pop()!.replace('.json', '')
  maps[name] = ctx[k]
}
function pickMapData(name?: string) {
  if (name && maps[name]) return maps[name]
  const def = (mapIndex as any).default
  return maps[def] || maps[Object.keys(maps)[0]]
}

export type AABB = { min: [number, number, number], max: [number, number, number] }

export function MapMeshes({ name }: { name?: string }) {
  const floorTx = useLoader(THREE.TextureLoader, new URL('../assets/textures/floor_grid.png', import.meta.url).toString())
  const wallTx = useLoader(THREE.TextureLoader, new URL('../assets/textures/wall_noise.png', import.meta.url).toString())
  // Configure textures (safe in render; R3F ensures it's set post-load)
  floorTx.colorSpace = THREE.SRGBColorSpace
  floorTx.wrapS = floorTx.wrapT = THREE.RepeatWrapping
  floorTx.repeat.set(10, 10)
  wallTx.colorSpace = THREE.SRGBColorSpace
  wallTx.wrapS = wallTx.wrapT = THREE.RepeatWrapping
  wallTx.repeat.set(4, 4)

  const matFloor = useMemo(() => new THREE.MeshStandardMaterial({ map: floorTx }), [floorTx])
  const matWall = useMemo(() => new THREE.MeshStandardMaterial({ map: wallTx }), [wallTx])
  const mapData = useMemo(() => pickMapData(name), [name])

  return (
    <group>
      {(mapData.aabbs as AABB[]).map((b, i) => {
        const size = [
          b.max[0] - b.min[0],
          b.max[1] - b.min[1],
          b.max[2] - b.min[2]
        ]
        const center = [
          (b.min[0] + b.max[0]) / 2,
          (b.min[1] + b.max[1]) / 2,
          (b.min[2] + b.max[2]) / 2
        ]
        const mat = i === 0 ? matFloor : matWall
        return (
          <mesh key={i} position={center as any} castShadow receiveShadow>
            <boxGeometry args={size as any} />
            {/* use primitive to avoid strict prop typing */}
            <primitive object={mat} attach="material" />
          </mesh>
        )
      })}
    </group>
  )
}
