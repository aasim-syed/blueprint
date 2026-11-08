# Blueprint Vision

Point your camera at anything. It becomes a live engineering drawing: ink edges, section hatching, dimension callouts, a parts list (BOM) and a title block.

Static site, no build step. Everything runs in the browser.

- **Edges + hatching**: WebGL2 shader (two-scale Sobel on mip-blurred luminance)
- **Depth**: Depth Anything V2 small via transformers.js on WebGPU (optional; silhouettes get heavy lines, background fades)
- **Callouts**: MediaPipe EfficientDet-Lite0 object detection → dims from real-world size priors

## Run locally
```
python3 -m http.server 8000   # then open http://localhost:8000
```
Camera access needs `localhost` or HTTPS.

## Deploy
Push to GitHub → import the repo in Vercel (framework: Other, no build command).

## Recording the X clip
1. Hit **HIDE UI** (H). Tap the screen to bring it back.
2. Hit **REC** (R). The clip opens on raw camera and wipes into the drawing after ~1s.
3. Bring objects into frame one at a time (mug, phone, bottle, book). Each one gets its own callout and BOM row.
4. Hit **M** mid-clip to flip to redline mode.
5. Press R again to stop. It downloads an MP4 on recent Chrome, WebM elsewhere (convert WebM to MP4 before posting to X).

Keys: M mode · D depth · Space wipe · R record · H hide UI · F flip camera
