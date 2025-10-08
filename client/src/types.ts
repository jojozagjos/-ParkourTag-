export type Vec3 = [number, number, number]

export type InputState = {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  jump: boolean
  sprint: boolean
  crouch: boolean
  yaw: number
  pitch: number
}

export type NetPlayer = {
  id: string
  name: string
  pos: Vec3
  vel: Vec3
  yaw: number
  pitch: number
  mode: 'ground' | 'air' | 'slide' | 'wallrunL' | 'wallrunR' | 'mantle'
}

export type Scores = Record<string, number>

export type Snapshot = {
  players: NetPlayer[]
  itId: string | null
  roundTime: number
  intermission: boolean
  mapName: string
  scores: Scores
}

export type RoundResults = {
  placement: Array<{ id: string, name: string, score: number }>
}
