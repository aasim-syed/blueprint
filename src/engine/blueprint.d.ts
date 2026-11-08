export type EngineStatus = { cam: string; det: string; depth: string; fps: number }

export type Engine = {
  start(): Promise<void>
  destroy(): void
  wipe(delay?: number): void
  flip(): Promise<void>
  toggleRec(): void
  setMode(mode: 0 | 1): void
  setDepth(on: boolean): void
  setThresh(v: number): void
  isRunning(): boolean
}

export function createEngine(opts: {
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  onStatus?: (s: EngineStatus) => void
  onRec?: (recording: boolean) => void
}): Engine
