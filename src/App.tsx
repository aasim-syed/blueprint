import { useCallback, useEffect, useRef, useState } from "react"

import { Splash } from "@/components/splash"
import { StatusBar } from "@/components/status-bar"
import { Toolbar } from "@/components/toolbar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { createEngine, type Engine, type EngineStatus } from "@/engine/blueprint"

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const engine = useRef<Engine | null>(null)

  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState("")
  const [status, setStatus] = useState<EngineStatus>({ cam: "…", det: "loading", depth: "…", fps: 0 })
  const [recording, setRecording] = useState(false)
  const [mode, setMode] = useState<0 | 1>(0)
  const [depth, setDepth] = useState(true)
  const [ink, setInk] = useState(0.3)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const e = createEngine({
      canvas: canvasRef.current!,
      video: videoRef.current!,
      onStatus: setStatus,
      onRec: setRecording,
    })
    engine.current = e
    return () => e.destroy()
  }, [])

  useEffect(() => engine.current?.setMode(mode), [mode])
  useEffect(() => engine.current?.setDepth(depth), [depth])
  useEffect(() => engine.current?.setThresh(ink), [ink])

  const start = async () => {
    setError("")
    setStarting(true)
    try {
      await engine.current!.start()
      setRunning(true)
    } catch (e) {
      const err = e as Error
      setError(err?.name === "NotAllowedError" ? "Camera permission denied." : String(err?.message || err))
    } finally {
      setStarting(false)
    }
  }

  const rec = useCallback(() => {
    try {
      engine.current?.toggleRec()
    } catch (e) {
      setError(String((e as Error).message))
    }
  }, [])
  const flip = useCallback(() => engine.current?.flip().catch(console.warn), [])

  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === "m") setMode((m) => (m ? 0 : 1))
      else if (k === "d") setDepth((d) => !d)
      else if (k === " ") {
        e.preventDefault()
        engine.current?.wipe(300)
      } else if (k === "r") rec()
      else if (k === "h") setHidden((h) => !h)
      else if (k === "f") flip()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [running, rec, flip])

  return (
    <TooltipProvider>
      <video ref={videoRef} playsInline muted className="hidden" />
      <canvas
        ref={canvasRef}
        className="fixed inset-0 block h-screen w-screen touch-manipulation"
        onClick={() => hidden && setHidden(false)}
      />
      <Splash hidden={running} starting={starting} error={error} onStart={start} />
      {running && !hidden && (
        <>
          <StatusBar status={status} />
          <Toolbar
            mode={mode}
            depth={depth}
            ink={ink}
            recording={recording}
            onMode={() => setMode((m) => (m ? 0 : 1))}
            onDepth={() => setDepth((d) => !d)}
            onInk={setInk}
            onWipe={() => engine.current?.wipe(300)}
            onFlip={flip}
            onRec={rec}
            onHide={() => setHidden(true)}
          />
        </>
      )}
    </TooltipProvider>
  )
}
