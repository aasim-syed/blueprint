import { Camera, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type Props = { hidden: boolean; starting: boolean; error: string; onStart: () => void }

export function Splash({ hidden, starting, error, onStart }: Props) {
  return (
    <div
      className={cn(
        "blueprint-grid fixed inset-0 z-10 grid place-items-center p-4 transition-opacity duration-500",
        hidden && "pointer-events-none opacity-0"
      )}
    >
      <Card className="w-full max-w-xl rounded-none border-2 border-foreground bg-transparent text-center shadow-none outline outline-1 outline-offset-[5px] outline-foreground">
        <CardHeader>
          <CardTitle className="text-[clamp(26px,6vw,40px)] font-bold tracking-[0.12em]">BLUEPRINT VISION</CardTitle>
          <CardDescription className="mt-2 leading-relaxed">
            Point your camera at anything.
            <br />
            Watch reality become an engineering drawing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="lg" className="rounded-none font-bold tracking-[0.2em]" onClick={onStart} disabled={starting}>
            {starting ? <Loader2 className="animate-spin" /> : <Camera />}
            START
          </Button>
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <p className="text-[11px] tracking-wide text-muted-foreground">
            Runs entirely in your browser · video never leaves your device
          </p>
          <p className="min-h-4 text-xs text-red-300">{error}</p>
        </CardFooter>
      </Card>
    </div>
  )
}
