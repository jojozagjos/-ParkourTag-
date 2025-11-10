import React, { useMemo } from 'react'
import * as THREE from 'three'

type Props = {
  size?: number
  topColor?: string
  bottomColor?: string
  sunDir?: [number, number, number] // normalized direction vector from origin to sun
  sunColor?: string
  sunSize?: number // radians, ~0.03-0.06 gives a nice disc
  sunIntensity?: number
  bottomDarkness?: number // 0..1 multiplier strength for darkening near ground
  bottomPower?: number // curve power for how fast it darkens toward the nadir
}

// A smooth gradient sky on a large inverted sphere, with an optional soft sun disc.
export default function Skybox({
  size = 800,
  topColor = '#bfe9ff',
  bottomColor = '#dae9f5ff',
  sunDir = [0.5, 0.8, 0.2],
  sunColor = '#fff6d5',
  sunSize = 0.045,
  sunIntensity = 1.5,
  bottomDarkness = 0.55,
  bottomPower = 1.8
}: Props) {
  const uniforms = useMemo(() => {
    const top = new THREE.Color(topColor).convertSRGBToLinear()
    const bottom = new THREE.Color(bottomColor).convertSRGBToLinear()
    const sun = new THREE.Color(sunColor).convertSRGBToLinear()
    const dir = new THREE.Vector3(...sunDir).normalize()
    return {
      uTop: { value: top },
      uBottom: { value: bottom },
      uSunDir: { value: dir },
      uSunCol: { value: sun },
      uSunSize: { value: sunSize },
      uSunIntensity: { value: sunIntensity },
      uDarkStrength: { value: bottomDarkness },
      uDarkPower: { value: bottomPower },
    }
  }, [topColor, bottomColor, sunColor, sunDir, sunSize, sunIntensity, bottomDarkness, bottomPower])

  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec3 vDir;
        void main(){
          // Use direction from camera (modelViewMatrix not applied) for stable sky
          vec4 p = modelMatrix * vec4(position,1.0);
          vDir = normalize(p.xyz);
          // Push to clip far plane subtly inside to avoid precision artifacts
          gl_Position = projectionMatrix * viewMatrix * vec4(p.xyz, 1.0);
          gl_Position.z = gl_Position.w * 0.9999; // ensure always at far depth without clipping
        }
      `,
      fragmentShader: `
        uniform vec3 uTop;
        uniform vec3 uBottom;
        uniform vec3 uSunDir;
        uniform vec3 uSunCol;
        uniform float uSunSize;
        uniform float uSunIntensity;
        uniform float uDarkStrength;
        uniform float uDarkPower;
        varying vec3 vDir;

        void main(){
          // Vertical gradient based on y of direction
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 base = mix(uBottom, uTop, pow(h, 1.2));
          // Darken towards the nadir (downwards). When h -> 0, (1-h) -> 1.
          float darkMul = 1.0 - uDarkStrength * pow(1.0 - h, uDarkPower);
          darkMul = clamp(darkMul, 0.0, 1.0);
          base *= darkMul;

          // Soft sun disc: angle between vDir and sunDir
          float cosA = dot(normalize(vDir), normalize(uSunDir));
          float inner = cos(uSunSize * 0.6);
          float outer = cos(uSunSize);
          float halo = smoothstep(outer, inner, cosA);
          vec3 col = base + uSunCol * uSunIntensity * halo;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    })
    return mat
  }, [uniforms])

  return (
    <mesh>
      <sphereGeometry args={[size, 64, 48]} />
      {/* @ts-ignore */}
      <primitive object={material} attach="material" />
    </mesh>
  )
}
