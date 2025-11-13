export type Vec3 = [number, number, number]

export type InputState = {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  jump: boolean
  sprint: boolean // Added sprint property
  crouch: boolean      // added for slide
  ability?: boolean    // ability activation (e.g. dash/grapple)
  yaw: number
  pitch: number
}

export type NetPlayer = {
  id: string
  name: string
  color?: string
  face?: 'default' | 'smile' | 'sunglasses'
  faceData?: string
  hat?: 'none' | 'cone' | 'halo' | 'glasses' | 'shades' | 'headphones' | 'bandana' | 'visor' | 'mask'
  pos: Vec3
  vel: Vec3
  yaw: number
  pitch: number
  onGround: boolean
  mode: 'ground' | 'air' | 'slide' | 'crouch' | 'wallrunL' | 'wallrunR' | 'mantle'
  // Remaining time (seconds) for the temporary chaining speed boost
  chainT?: number
  itAbility?: 'none' | 'dash' | 'grapple'
  // Dash ability state
  itDashT?: number
  itDashCd?: number
  // Grapple ability state
  itGrappleActive?: boolean
  itGrappleCd?: number
  itGrappleTarget?: { x: number, y: number, z: number } | null
}

export type Scores = Record<string, number>

export type Snapshot = {
  players: NetPlayer[]
  itId: string | null
  roundTime: number
  intermission: boolean
  mapName: string
  scores: Scores
  state?: string
  maps?: string[]
  gameMode?: 'default' | 'noAbility' | 'dark' | 'runners'
}

export type RoundResults = {
  placement: Array<{ id: string, name: string, score: number }>
}
