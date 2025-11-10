import * as THREE from 'three'
import { useMemo } from 'react'

// Load maps from shared/maps using Vite glob so the bundler can find them at build time
import mapIndex from '../../shared/maps/index.json'
const maps: Record<string, any> = {}
const ctx = import.meta.glob('../../shared/maps/*.json', { eager: true, query: '?json' }) as Record<string, any>
for (const k of Object.keys(ctx)) {
  // key will be like '../../shared/maps/ParkourYard.json'
  const name = k.split('/').pop()!.replace('.json', '')
  maps[name] = ctx[k]
}
const mapData = maps[(mapIndex as any).default] || maps[Object.keys(maps)[0]]

export type AABB = { min: [number, number, number], max: [number, number, number] }

export function MapMeshes() {
  const loader = new THREE.TextureLoader()
  const floorTx = useMemo(() => {
    const t = loader.load(new URL('../assets/textures/floor_grid.png', import.meta.url).toString())
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(10, 10)
    return t
  }, [])
  const wallTx = useMemo(() => {
    const t = loader.load(new URL('../assets/textures/wall_noise.png', import.meta.url).toString())
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(4, 4)
    return t
  }, [])

  const matFloor = useMemo(() => new THREE.MeshStandardMaterial({ map: floorTx }), [floorTx])
  const matWall = useMemo(() => new THREE.MeshStandardMaterial({ map: wallTx }), [wallTx])

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
