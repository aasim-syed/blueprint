# Blueprint Vision

Point your camera at anything. It becomes a live engineering drawing: ink edges, section hatching, dimension callouts, a parts list (BOM) and a title block.

React + Vite + Tailwind v4 + shadcn/ui. Everything runs in the browser; no server.

- **Edges + hatching**: WebGL2 shader (two-scale Sobel on mip-blurred luminance)
- **Depth**: Depth Anything V2 small via transformers.js on WebGPU (optional; silhouettes get heavy lines, background fades)
- **Callouts**: MediaPipe EfficientDet-Lite0 object detection → dims from real-world size priors

## Structure
- `src/engine/blueprint.js` — framework-agnostic engine (WebGL2 shader, detection, depth, overlay, recorder). `createEngine({ canvas, video, onStatus, onRec })`
- `src/App.tsx` — wires the engine to React state + hotkeys
- `src/components/` — splash, status badges, toolbar (shadcn `button`, `card`, `slider`, `tooltip`, `badge`, `kbd`, `separator`)

## Run locally
```
npm i
npm run dev      # http://localhost:5173
```
Camera access needs `localhost` or HTTPS. Add more shadcn components with `npx shadcn@latest add <name>`.

## Deploy
Vercel auto-deploys `main` (framework: Vite, see `vercel.json`).

## Recording the X clip
1. Hit **HIDE UI** (H). Tap the screen to bring it back.
2. Hit **REC** (R). The clip opens on raw camera and wipes into the drawing after ~1s.
3. Bring objects into frame one at a time (mug, phone, bottle, book). Each one gets its own callout and BOM row.
4. Hit **M** mid-clip to flip to redline mode.
5. Press R again to stop. It downloads an MP4 on recent Chrome, WebM elsewhere (convert WebM to MP4 before posting to X).

Keys: M mode · D depth · Space wipe · R record · H hide UI · F flip camera
