import type { ReactNode } from "react"
import { Circle, EyeOff, Layers, PenLine, RefreshCcw, ScanLine, Square, SwitchCamera } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type Props = {
  mode: 0 | 1
  depth: boolean
  ink: number
  recording: boolean
  onMode: () => void
  onDepth: () => void
  onInk: (v: number) => void
  onWipe: () => void
  onFlip: () => void
  onRec: () => void
  onHide: () => void
}

function Tip({ label, k, children }: { label: string; k: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        {label} <Kbd>{k}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

const btn = "rounded-none text-xs tracking-wider"

export function Toolbar(p: Props) {
  return (
    <div className="fixed bottom-[max(14px,env(safe-area-inset-bottom))] left-1/2 z-5 flex w-max max-w-[calc(100vw-24px)] -translate-x-1/2 lg:left-10 lg:translate-x-0 lg:bottom-10 flex-wrap items-center justify-center gap-1.5 border bg-card/85 p-1.5 backdrop-blur">
      <Tip label="Toggle style" k="M">
        <Button variant="outline" size="sm" className={btn} onClick={p.onMode}>
          {p.mode === 0 ? <ScanLine /> : <PenLine />}
          {p.mode === 0 ? "BLUEPRINT" : "REDLINE"}
        </Button>
      </Tip>
      <Tip label="Depth silhouettes" k="D">
        <Button variant="outline" size="sm" className={cn(btn, p.depth && "bg-accent text-accent-foreground")} onClick={p.onDepth}>
          <Layers />
          DEPTH {p.depth ? "ON" : "OFF"}
        </Button>
      </Tip>
      <div className="flex h-8 items-center gap-2 border px-3 text-xs tracking-wider">
        INK
        <Slider className="w-24" min={0.12} max={0.6} step={0.01} value={[p.ink]} onValueChange={([v]) => p.onInk(v)} />
      </div>
      <Separator orientation="vertical" className="mx-0.5 !h-6" />
      <Tip label="Re-run scan wipe" k="Space">
        <Button variant="outline" size="sm" className={btn} onClick={p.onWipe}>
          <RefreshCcw /> WIPE
        </Button>
      </Tip>
      <Tip label="Switch camera" k="F">
        <Button variant="outline" size="sm" className={btn} onClick={p.onFlip}>
          <SwitchCamera /> CAM
        </Button>
      </Tip>
      <Tip label={p.recording ? "Stop and download" : "Record clip"} k="R">
        <Button variant={p.recording ? "destructive" : "outline"} size="sm" className={btn} onClick={p.onRec}>
          {p.recording ? <Square className="fill-current" /> : <Circle className="fill-red-400 text-red-400" />}
          {p.recording ? "STOP" : "REC"}
        </Button>
      </Tip>
      <Tip label="Hide UI (tap to restore)" k="H">
        <Button variant="outline" size="sm" className={btn} onClick={p.onHide}>
          <EyeOff /> HIDE
        </Button>
      </Tip>
    </div>
  )
}
