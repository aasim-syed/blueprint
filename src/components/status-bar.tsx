import { Badge } from "@/components/ui/badge"
import type { EngineStatus } from "@/engine/blueprint"

const ok = (v: string) => v === "✓"

function Item({ label, value }: { label: string; value: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 rounded-none border-border/60 bg-card/80 text-[11px] tracking-wider backdrop-blur">
      <span className={ok(value) ? "size-1.5 rounded-full bg-emerald-400" : "size-1.5 rounded-full bg-amber-300 animate-pulse"} />
      {label} <span className="text-muted-foreground">{value}</span>
    </Badge>
  )
}

export function StatusBar({ status }: { status: EngineStatus }) {
  return (
    <div className="pointer-events-none fixed left-1/2 top-[max(46px,env(safe-area-inset-top))] z-5 flex -translate-x-1/2 gap-1.5">
      <Item label="CAM" value={status.cam} />
      <Item label="DETECT" value={status.det} />
      <Item label="DEPTH" value={status.depth} />
      <Badge variant="outline" className="rounded-none border-border/60 bg-card/80 text-[11px] tabular-nums tracking-wider backdrop-blur">
        {status.fps} FPS
      </Badge>
    </div>
  )
}
