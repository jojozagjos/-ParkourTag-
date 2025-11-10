import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

/**
 * EnvironmentHDRI
 * - Loads an HDRI (equirectangular) and applies it to scene.background and/or scene.environment.
 * - Uses PMREM to prefilter for proper IBL.
 *
 * Props:
 * - src: string URL to the .hdr file (absolute or relative to site origin)
 * - background?: boolean (default true) sets scene.background
 * - environment?: boolean (default true) sets scene.environment
 */
export default function EnvironmentHDRI({
  src,
  background = true,
  environment = true
}: {
  src: string
  background?: boolean
  environment?: boolean
}) {
  const { gl, scene } = useThree()
  const prevBg = useRef<THREE.Texture | null>(null)
  const prevEnv = useRef<THREE.Texture | null>(null)

  useEffect(() => {
    if (!src) return

    const pmrem = new THREE.PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()

    const loader = new RGBELoader()
    loader.setDataType(THREE.UnsignedByteType)

    let disposed = false

    loader.load(
      src,
      (hdr) => {
        if (disposed) { hdr.dispose(); return }
        const envMap = pmrem.fromEquirectangular(hdr).texture
        hdr.dispose()
        pmrem.dispose()

        // Save previous
        prevBg.current = (scene.background as THREE.Texture) || null
        prevEnv.current = (scene.environment as THREE.Texture) || null

        if (background) scene.background = envMap
        if (environment) scene.environment = envMap
      },
      undefined,
      (err) => {
        console.warn('HDRI load failed:', src, err)
        pmrem.dispose()
      }
    )

    return () => {
      disposed = true
      // Restore previous background/environment
      if (background) scene.background = prevBg.current
      if (environment) scene.environment = prevEnv.current
    }
  }, [src, background, environment, gl, scene])

  return null
}
