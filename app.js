// Blueprint Vision — live camera → engineering drawing.
// Edges + hatching in a WebGL2 shader, optional monocular depth (Depth Anything V2 on WebGPU),
// object detection (MediaPipe EfficientDet) for dimension callouts, BOM and title block.

const MP_VER = "0.10.14";
const TF_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1";

const $ = (s) => document.querySelector(s);
const video = $("#video");
const out = $("#out");
const ctx = out.getContext("2d");
const glc = document.createElement("canvas");
const gl = glc.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });

const state = {
  mode: 0, // 0 blueprint, 1 vellum/redline
  depthOn: true,
  facing: "user",
  thresh: 0.3,
  revealStart: Infinity,
  hidden: false,
};

let W = 0, H = 0, S = 1;
let stream = null, detector = null, depthPipe = null, RawImg = null;
let hasDepth = false, rec = null, chunks = [], recMime = "";
let tracks = [], uid = 0, partNo = 0, lastDet = 0, last = 0, running = false;
const status = { cam: "…", det: "loading", depth: "…", fps: 0 };
const dwgNo = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `BV-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
})();

// ---------- real-world size priors (mm) for monocular dimension estimates ----------
// [axis the prior describes, size in mm, drawing description, round?]
const SPEC = {
  person: ["w", 440, "OPERATOR ASSY"],
  cup: ["h", 95, "VESSEL, CYLINDRICAL", true],
  "wine glass": ["h", 200, "GOBLET, STEMMED", true],
  bottle: ["h", 230, "CONTAINER, FLUID"],
  bowl: ["w", 160, "BOWL, HEMISPHERIC", true],
  "cell phone": ["h", 147, "HANDHELD UNIT"],
  laptop: ["w", 312, "COMPUTE MODULE"],
  keyboard: ["w", 440, "INPUT ARRAY"],
  mouse: ["w", 62, "POINTING DEVICE"],
  remote: ["h", 180, "IR CONTROLLER"],
  tv: ["w", 900, "DISPLAY PANEL"],
  book: ["h", 230, "DATA STACK, PAPER"],
  clock: ["w", 300, "CHRONOMETER", true],
  scissors: ["h", 170, "SHEAR TOOL"],
  "potted plant": ["h", 320, "BIO-UNIT, POTTED"],
  vase: ["h", 260, "VASE", true],
  chair: ["h", 880, "SEAT FRAME"],
  couch: ["w", 2000, "SEATING ASSY"],
  bed: ["w", 1500, "REST PLATFORM"],
  "dining table": ["w", 1400, "WORK SURFACE"],
  banana: ["w", 185, "ORGANIC CURVE"],
  apple: ["h", 80, "SPHEROID, ORGANIC", true],
  orange: ["h", 75, "SPHEROID, CITRUS", true],
  donut: ["w", 90, "TORUS, EDIBLE", true],
  "sports ball": ["h", 220, "SPHERE", true],
  "teddy bear": ["h", 300, "PLUSH ASSY"],
  toothbrush: ["h", 190, "CLEANING TOOL"],
  fork: ["h", 190, "UTENSIL, TINED"],
  knife: ["h", 220, "UTENSIL, BLADE"],
  spoon: ["h", 170, "UTENSIL, CONCAVE"],
  backpack: ["h", 460, "CARGO MODULE"],
  handbag: ["w", 300, "CARGO MODULE, SM"],
  umbrella: ["w", 1000, "CANOPY ASSY"],
  dog: ["h", 550, "K9 UNIT"],
  cat: ["h", 250, "FELINE UNIT"],
  bird: ["h", 150, "AVIAN UNIT"],
  car: ["w", 4500, "VEHICLE"],
  bicycle: ["w", 1750, "HUMAN-POWERED VEHICLE"],
  tie: ["h", 1400, "NECK RESTRAINT"],
  "hair drier": ["h", 230, "THERMAL BLOWER"],
  "cake": ["w", 220, "CAKE, LAYERED", true],
};

// ---------- sizing ----------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = innerWidth * dpr, h = innerHeight * dpr;
  const k = Math.min(1, 1920 / Math.max(w, h));
  W = Math.round(w * k);
  H = Math.round(h * k);
  out.width = glc.width = W;
  out.height = glc.height = H;
  S = Math.max(0.75, Math.min(W, H) / 820);
}
addEventListener("resize", resize);
resize();

// ---------- WebGL ----------
const VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
void main(){ gl_Position = vec4(P[gl_VertexID], 0., 1.); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uVid;
uniform sampler2D uDepth;
uniform vec2 uRes, uVidRes;
uniform float uMirror, uTime, uReveal, uHasDepth, uMode, uThresh, uS;
out vec4 o;

float K; vec2 OFF;
vec2 toUV(vec2 f){ vec2 uv = (f - OFF) / (uVidRes * K); if (uMirror > .5) uv.x = 1. - uv.x; return uv; }
float L(vec2 uv, float lod){ return dot(textureLod(uVid, uv, lod).rgb, vec3(.299, .587, .114)); }
float Dp(vec2 uv){ return texture(uDepth, uv).r; }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float sobL(vec2 uv, vec2 d, float lod){
  float tl=L(uv+d*vec2(-1.,-1.),lod), t=L(uv+d*vec2(0.,-1.),lod), tr=L(uv+d*vec2(1.,-1.),lod);
  float l=L(uv+d*vec2(-1.,0.),lod),                                 r=L(uv+d*vec2(1.,0.),lod);
  float bl=L(uv+d*vec2(-1.,1.),lod), b=L(uv+d*vec2(0.,1.),lod),   br=L(uv+d*vec2(1.,1.),lod);
  return length(vec2(-tl-2.*l-bl+tr+2.*r+br, -tl-2.*t-tr+bl+2.*b+br));
}
float sobD(vec2 uv, vec2 d){
  float tl=Dp(uv+d*vec2(-1.,-1.)), t=Dp(uv+d*vec2(0.,-1.)), tr=Dp(uv+d*vec2(1.,-1.));
  float l=Dp(uv+d*vec2(-1.,0.)),                             r=Dp(uv+d*vec2(1.,0.));
  float bl=Dp(uv+d*vec2(-1.,1.)), b=Dp(uv+d*vec2(0.,1.)),   br=Dp(uv+d*vec2(1.,1.));
  return length(vec2(-tl-2.*l-bl+tr+2.*r+br, -tl-2.*t-tr+bl+2.*b+br));
}

void main(){
  vec2 f = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 s = uRes / uVidRes; K = max(s.x, s.y); OFF = (uRes - uVidRes * K) * .5;
  vec2 uv = toUV(f);
  vec2 d = 1. / uVidRes;

  // ink: two-scale edges on mip-blurred luminance
  float e = sobL(uv, d * 1.2, .6) * .6 + sobL(uv, d * 2.6, 1.5) * .5;
  float ink = smoothstep(uThresh, uThresh + .18, e);

  // depth: silhouettes get heavy lines, background fades out
  float near = 1.;
  if (uHasDepth > .5) {
    float z = Dp(uv);
    near = smoothstep(.10, .50, z);
    float de = sobD(uv, d * 3.5);
    float sil = smoothstep(.05, .14, de) * smoothstep(.04, .25, z);
    ink = max(ink * mix(.22, 1., near), sil);
  }

  // section hatching in dark regions
  float dark = 1. - L(uv, 3.2);
  float sp = 7. * uS;
  float h1 = 1. - smoothstep(0., 1.3 * uS, mod(f.x + f.y, sp));
  float h2 = 1. - smoothstep(0., 1.3 * uS, mod(f.x - f.y + 4096., sp));
  float hatch = (h1 * smoothstep(.52, .62, dark) + h2 * smoothstep(.72, .80, dark)) * .5 * near;

  // drafting grid
  float g = 24. * uS;
  vec2 gm = mod(f, g), GM = mod(f, g * 5.);
  float minor = (gm.x < uS || gm.y < uS) ? 1. : 0.;
  float major = (GM.x < 1.5 * uS || GM.y < 1.5 * uS) ? 1. : 0.;
  float grid = max(minor * .07, major * .17);

  vec3 bg   = uMode < .5 ? vec3(.04, .21, .47) : vec3(.95, .93, .87);
  vec3 inkC = uMode < .5 ? vec3(.90, .95, 1.0) : vec3(.07, .12, .24);
  vec3 grC  = uMode < .5 ? vec3(.55, .80, 1.0) : vec3(.30, .52, .82);
  vec2 q = f / uRes - .5;
  bg *= 1. - dot(q, q) * .55;
  bg += (hash(floor(f / uS) + floor(uTime * 24.)) - .5) * .025;

  vec3 col = mix(bg, grC, grid);
  col = mix(col, inkC, clamp(max(ink, hatch), 0., 1.));

  // scan-wipe reveal: raw camera below the line, drawing above
  float edge = uReveal * uRes.y;
  vec3 raw = textureLod(uVid, uv, 0.).rgb;
  vec3 res = f.y < edge ? col : raw * .92;
  float glow = exp(-abs(f.y - edge) / (5. * uS)) * step(.0005, uReveal) * step(uReveal, .9995);
  res += vec3(.35, .85, 1.) * glow * 1.2;
  o = vec4(res, 1.);
}`;

function sh(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
let prog, U = {}, vidTex, depthTex;
function initGL() {
  if (!gl) throw new Error("WebGL2 not available in this browser.");
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  for (const n of ["uVid", "uDepth", "uRes", "uVidRes", "uMirror", "uTime", "uReveal", "uHasDepth", "uMode", "uThresh", "uS"])
    U[n] = gl.getUniformLocation(prog, n);
  gl.bindVertexArray(gl.createVertexArray());

  vidTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, vidTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  depthTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));

  gl.uniform1i(U.uVid, 0);
  gl.uniform1i(U.uDepth, 1);
}

function uploadDepth(w, h, data) {
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
}

function renderGL(now, reveal) {
  gl.viewport(0, 0, W, H);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, vidTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.uniform2f(U.uRes, W, H);
  gl.uniform2f(U.uVidRes, video.videoWidth, video.videoHeight);
  gl.uniform1f(U.uMirror, mirror() ? 1 : 0);
  gl.uniform1f(U.uTime, now / 1000);
  gl.uniform1f(U.uReveal, reveal);
  gl.uniform1f(U.uHasDepth, hasDepth && state.depthOn ? 1 : 0);
  gl.uniform1f(U.uMode, state.mode);
  gl.uniform1f(U.uThresh, state.thresh);
  gl.uniform1f(U.uS, S);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ---------- camera ----------
const mirror = () => state.facing === "user";
async function startCam() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  status.cam = "✓";
}

// ---------- object detection ----------
async function initDetector() {
  try {
    const { FilesetResolver, ObjectDetector } = await import(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`
    );
    const fs = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`);
    const opts = (delegate) => ({
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
        delegate,
      },
      runningMode: "VIDEO",
      scoreThreshold: 0.38,
      maxResults: 5,
    });
    try { detector = await ObjectDetector.createFromOptions(fs, opts("GPU")); }
    catch { detector = await ObjectDetector.createFromOptions(fs, opts("CPU")); }
    status.det = "✓";
  } catch (e) {
    console.warn("detector failed", e);
    status.det = "off";
  }
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i + 1e-6);
}

function updateTracks(dets, now) {
  const used = new Set();
  for (const d of dets) {
    const cat = d.categories && d.categories[0];
    if (!cat || !d.boundingBox) continue;
    const bb = d.boundingBox;
    const box = { x: bb.originX, y: bb.originY, w: bb.width, h: bb.height };
    let best = null, bi = 0.12;
    for (const t of tracks) {
      if (used.has(t) || t.cls !== cat.categoryName) continue;
      const v = iou(t.target, box);
      if (v > bi) { bi = v; best = t; }
    }
    if (!best) {
      best = { id: ++uid, num: ++partNo, cls: cat.categoryName, box: { ...box }, target: box, born: now, seen: now, score: cat.score, wmm: 0, hmm: 0 };
      tracks.push(best);
    }
    best.target = box;
    best.seen = now;
    best.score = cat.score;
    used.add(best);
  }
  tracks = tracks.filter((t) => now - t.seen < 900);
}

// ---------- depth ----------
async function initDepth() {
  if (!navigator.gpu) { status.depth = "needs WebGPU"; return; }
  status.depth = "0%";
  try {
    const { pipeline, RawImage, env } = await import(TF_URL);
    env.allowLocalModels = false;
    const prog = {};
    const cb = (p) => {
      if (p.status === "progress" && p.file && p.file.endsWith(".onnx")) {
        prog[p.file] = p.progress || 0;
        status.depth = `${Math.round(Math.max(...Object.values(prog)))}%`;
      }
    };
    const model = "onnx-community/depth-anything-v2-small";
    try { depthPipe = await pipeline("depth-estimation", model, { device: "webgpu", dtype: "fp16", progress_callback: cb }); }
    catch { depthPipe = await pipeline("depth-estimation", model, { device: "webgpu", dtype: "fp32", progress_callback: cb }); }
    RawImg = RawImage;
    status.depth = "✓";
    depthLoop();
  } catch (e) {
    console.warn("depth failed", e);
    status.depth = "off";
  }
}

async function depthLoop() {
  const c = document.createElement("canvas");
  const cx = c.getContext("2d", { willReadFrequently: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    if (!state.depthOn || video.readyState < 2) { await sleep(150); continue; }
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      c.width = 384;
      c.height = Math.round((384 * vh) / vw);
      cx.drawImage(video, 0, 0, c.width, c.height);
      const { depth } = await depthPipe(RawImg.fromCanvas(c));
      const ch = depth.channels || 1;
      let data = depth.data;
      if (ch !== 1) {
        const m = new Uint8Array(depth.width * depth.height);
        for (let i = 0; i < m.length; i++) m[i] = data[i * ch];
        data = m;
      } else if (!(data instanceof Uint8Array)) {
        data = new Uint8Array(data.buffer, data.byteOffset, data.length);
      }
      uploadDepth(depth.width, depth.height, data);
      hasDepth = true;
    } catch (e) {
      console.warn(e);
      await sleep(500);
    }
    await sleep(0);
  }
}

// ---------- overlay drawing ----------
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (t) => 1 - Math.pow(1 - clamp(t), 3);
const lerp = (a, b, t) => a + (b - a) * t;
const font = (px, w = 400) => `${w} ${Math.round(px * S)}px "IBM Plex Mono", ui-monospace, monospace`;
const colors = () =>
  state.mode === 0
    ? { ink: "#e6f0ff", acc: "#7fdcff", dim: "rgba(230,240,255,.55)", paper: "rgba(6,34,80,.92)", halo: "rgba(8,40,90,.9)" }
    : { ink: "#14213d", acc: "#c0392b", dim: "rgba(20,33,61,.5)", paper: "rgba(246,243,234,.94)", halo: "rgba(243,239,228,.92)" };

function v2s(x, y) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const k = Math.max(W / vw, H / vh);
  const ox = (W - vw * k) / 2, oy = (H - vh * k) / 2;
  let sx = ox + x * k;
  if (mirror()) sx = W - sx;
  return [sx, oy + y * k];
}
function boxToScreen(b) {
  const [x1, y1] = v2s(b.x, b.y);
  const [x2, y2] = v2s(b.x + b.w, b.y + b.h);
  return { x: Math.min(x1, x2), y: y1, w: Math.abs(x2 - x1), h: y2 - y1 };
}
function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function arrow(x, y, ang) {
  const L = 9 * S, A = 0.32;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - L * Math.cos(ang - A), y - L * Math.sin(ang - A));
  ctx.lineTo(x - L * Math.cos(ang + A), y - L * Math.sin(ang + A));
  ctx.closePath();
  ctx.fill();
}
const fmt = (mm) => {
  const n = Math.round(mm);
  return n >= 1000 ? `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, "0")}` : String(n);
};
function ht(C, txt, x, y) {
  ctx.save(); ctx.lineJoin = "round"; ctx.lineWidth = 4.5 * S; ctx.strokeStyle = C.halo; ctx.strokeText(txt, x, y); ctx.restore();
  ctx.fillText(txt, x, y);
}
const typed = (str, p) => str.slice(0, Math.ceil(str.length * clamp(p)));

function drawTrack(t, now, C, margin) {
  const b = boxToScreen(t.box);
  if (b.w < 8 || b.h < 8) return;
  const p = ease((now - t.born) / 950);
  const fade = clamp(1 - (now - t.seen - 350) / 450);
  const spec = SPEC[t.cls];
  const round = spec && spec[3];
  ctx.globalAlpha = fade;
  ctx.strokeStyle = C.ink;
  ctx.fillStyle = C.ink;
  ctx.lineWidth = 1.3 * S;

  // corner brackets
  const c = Math.min(b.w, b.h) * 0.16 * p;
  const corners = [[b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1], [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1]];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath(); ctx.moveTo(x + sx * c, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * c); ctx.stroke();
  }

  // centre lines (chain)
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, ext = 14 * S;
  ctx.save();
  ctx.lineWidth = 0.9 * S;
  ctx.strokeStyle = C.acc;
  ctx.setLineDash([18 * S, 4 * S, 3 * S, 4 * S]);
  line(cx, b.y - ext, cx, lerp(b.y - ext, b.y + b.h + ext, p));
  line(b.x - ext, cy, lerp(b.x - ext, b.x + b.w + ext, p), cy);
  ctx.restore();

  const tp = clamp((now - t.born - 450) / 600); // text typing progress
  const off = 28 * S, gap = 6 * S;

  // width dimension (below, or above if no room)
  {
    const below = b.y + b.h + off + 22 * S < H - margin;
    const yb = below ? b.y + b.h : b.y;
    const s = below ? 1 : -1;
    const y = yb + s * off;
    line(b.x, yb + s * gap, b.x, lerp(yb + s * gap, y + s * 6 * S, p));
    line(b.x + b.w, yb + s * gap, b.x + b.w, lerp(yb + s * gap, y + s * 6 * S, p));
    const half = (b.w / 2) * p;
    line(cx - half, y, cx + half, y);
    if (p > 0.85) { arrow(b.x, y, Math.PI); arrow(b.x + b.w, y, 0); }
    const txt = `${round ? "Ø" : ""}${fmt(t.wmm)}`;
    ctx.font = font(15, 600);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ht(C, typed(txt, tp), cx, y - 3 * S);
  }

  // height dimension (right, or left if no room)
  {
    const right = b.x + b.w + off + 30 * S < W - margin;
    const xb = right ? b.x + b.w : b.x;
    const s = right ? 1 : -1;
    const x = xb + s * off;
    line(xb + s * gap, b.y, lerp(xb + s * gap, x + s * 6 * S, p), b.y);
    line(xb + s * gap, b.y + b.h, lerp(xb + s * gap, x + s * 6 * S, p), b.y + b.h);
    const half = (b.h / 2) * p;
    line(x, cy - half, x, cy + half);
    if (p > 0.85) { arrow(x, b.y, -Math.PI / 2); arrow(x, b.y + b.h, Math.PI / 2); }
    ctx.save();
    ctx.translate(x - 4 * S, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.font = font(15, 600);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ht(C, typed(fmt(t.hmm), tp), 0, 0);
    ctx.restore();
  }

  // leader + balloon + part label
  {
    const toLeft = b.x > W * 0.35;
    const sx = toLeft ? b.x : b.x + b.w;
    const sy = b.y;
    let ex = sx + (toLeft ? -1 : 1) * 34 * S, ey = sy - 34 * S;
    ex = clamp(ex, margin + 70 * S, W - margin - 70 * S);
    ey = clamp(ey, margin + 20 * S, H - margin);
    ctx.lineWidth = 1 * S;
    const lp = ease((now - t.born - 200) / 500);
    ctx.beginPath(); ctx.arc(sx, sy, 2.6 * S, 0, Math.PI * 2); ctx.fill();
    line(sx, sy, lerp(sx, ex, lp), lerp(sy, ey, lp));
    if (lp > 0.95) {
      const r = 12 * S;
      const bx = ex + (toLeft ? -r : r);
      ctx.beginPath(); ctx.arc(bx, ey, r, 0, Math.PI * 2); ctx.stroke();
      ctx.font = font(12, 700);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ht(C, String(t.num), bx, ey + 0.5 * S);
      const desc = spec ? spec[2] : t.cls.toUpperCase();
      ctx.textAlign = toLeft ? "right" : "left";
      const tx = bx + (toLeft ? -r - 6 * S : r + 6 * S);
      ctx.font = font(12.5, 700);
      ctx.textBaseline = "bottom";
      ht(C, typed(desc, tp), tx, ey);
      ctx.font = font(10.5);
      ctx.textBaseline = "top";
      ctx.fillStyle = C.dim;
      ht(C, typed(`PN BV-${String(t.num).padStart(4, "0")} · CONF ${t.score.toFixed(2)}`, tp), tx, ey + 2 * S);
      ctx.fillStyle = C.ink;
    }
  }
  ctx.globalAlpha = 1;
}

function drawFrame(C, margin, inset) {
  ctx.strokeStyle = C.ink;
  ctx.fillStyle = C.ink;
  ctx.lineWidth = 2 * S;
  ctx.strokeRect(margin, margin, W - 2 * margin, H - 2 * margin);
  ctx.lineWidth = 1 * S;
  ctx.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset);
  // zones
  ctx.font = font(9.5, 600);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cols = Math.max(2, Math.round((W - 2 * inset) / (230 * S)));
  const rows = Math.max(2, Math.round((H - 2 * inset) / (230 * S)));
  const cw = (W - 2 * inset) / cols, rh = (H - 2 * inset) / rows;
  const band = (inset - margin) / 2;
  for (let i = 0; i < cols; i++) {
    const x = inset + cw * (i + 0.5);
    const lbl = String(cols - i);
    ctx.fillText(lbl, x, margin + band);
    ctx.fillText(lbl, x, H - margin - band);
    if (i) { line(inset + cw * i, margin, inset + cw * i, inset); line(inset + cw * i, H - inset, inset + cw * i, H - margin); }
  }
  for (let j = 0; j < rows; j++) {
    const y = inset + rh * (j + 0.5);
    const lbl = String.fromCharCode(65 + (rows - 1 - j));
    ctx.fillText(lbl, margin + band, y);
    ctx.fillText(lbl, W - margin - band, y);
    if (j) { line(margin, inset + rh * j, inset, inset + rh * j); line(W - inset, inset + rh * j, W - margin, inset + rh * j); }
  }
}

function cellText(txt, x, y, size = 10, weight = 400, color) {
  ctx.font = font(size, weight);
  if (color) ctx.fillStyle = color;
  ctx.fillText(txt, x, y);
}

function drawTitleBlock(C, inset, now) {
  const tw = Math.min(400 * S, W * 0.62), th = 92 * S;
  const x = W - inset - tw, y = H - inset - th;
  ctx.fillStyle = C.paper;
  ctx.fillRect(x, y, tw, th);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.4 * S;
  ctx.strokeRect(x, y, tw, th);
  ctx.lineWidth = 0.8 * S;
  const r1 = y + th * 0.42, r2 = y + th * 0.71, c1 = x + tw * 0.62, c2 = x + tw * 0.33;
  line(x, r1, x + tw, r1);
  line(x, r2, x + tw, r2);
  line(c1, y, c1, y + th);
  line(c2, r1, c2, y + th);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const pad = 6 * S;
  cellText("TITLE", x + pad, y + pad * 0.7, 7.5, 400, C.dim);
  cellText("BLUEPRINT VISION", x + pad, y + pad * 0.7 + 11 * S, Math.min(17, (tw * 0.62) / S / 10.5), 700, C.ink);
  cellText("DRAWN BY", c1 + pad, y + pad * 0.7, 7.5, 400, C.dim);
  cellText("AI · LIVE", c1 + pad, y + pad * 0.7 + 11 * S, 12, 700, C.ink);
  const t = new Date(now + performance.timeOrigin);
  const clock = t.toTimeString().slice(0, 8);
  const rows = [
    [x, r1, "DWG NO.", dwgNo], [c2, r1, "SCALE", "1:1 (EST.)"], [c1, r1, "TIME", clock],
    [x, r2, "UNITS", "MM"], [c2, r2, "DEPTH", hasDepth && state.depthOn ? "DA-V2 ON" : "OFF"], [c1, r2, "SHEET", `1 / 1 · REV ${String.fromCharCode(65 + (partNo % 26))}`],
  ];
  for (const [cx, cy, k, v] of rows) {
    cellText(k, cx + pad, cy + 3 * S, 7.5, 400, C.dim);
    cellText(v, cx + pad, cy + 12.5 * S, 10.5, 600, C.ink);
  }
}

function drawNotes(C, inset) {
  const x = inset + 12 * S;
  let y = inset + 12 * S;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = C.ink;
  cellText("NOTES:", x, y, 11, 700, C.ink);
  y += 17 * S;
  const notes = [
    "1. ALL DIMS IN MM, ESTIMATED FROM MONOCULAR VIDEO.",
    `2. DEPTH: ${hasDepth && state.depthOn ? "DEPTH-ANYTHING V2 · WEBGPU" : "NOT APPLIED"}.`,
    "3. DO NOT SCALE REALITY.",
  ];
  const maxChars = Math.floor((W * 0.5) / (6.3 * S));
  for (const n of notes) { cellText(n.slice(0, maxChars), x, y, 9.5, 400, C.ink); y += 14 * S; }
}

function drawBOM(C, inset, list) {
  if (!list.length) return;
  const counts = new Map();
  for (const t of list) {
    const k = t.cls;
    if (!counts.has(k)) counts.set(k, { num: t.num, qty: 0, desc: SPEC[k] ? SPEC[k][2] : k.toUpperCase() });
    counts.get(k).qty++;
  }
  const rows = [...counts.values()].sort((a, b) => a.num - b.num).slice(0, 6);
  const rh = 17 * S, w = Math.min(290 * S, W * 0.42);
  const x = W - inset - w - 12 * S, y = inset + 12 * S;
  const h = rh * (rows.length + 1);
  ctx.fillStyle = C.paper;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1 * S;
  ctx.strokeRect(x, y, w, h);
  const c1 = x + 34 * S, c2 = x + w - 38 * S;
  line(c1, y, c1, y + h);
  line(c2, y, c2, y + h);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const pad = 6 * S;
  cellText("ITEM", x + pad, y + rh / 2, 8, 700, C.ink);
  cellText("DESCRIPTION", c1 + pad, y + rh / 2, 8, 700, C.ink);
  cellText("QTY", c2 + pad, y + rh / 2, 8, 700, C.ink);
  const maxChars = Math.floor((c2 - c1 - 2 * pad) / (6 * S));
  rows.forEach((r, i) => {
    const ry = y + rh * (i + 1);
    line(x, ry, x + w, ry);
    cellText(String(r.num), x + pad, ry + rh / 2, 9.5, 600, C.ink);
    cellText(r.desc.slice(0, maxChars), c1 + pad, ry + rh / 2, 9.5, 400, C.ink);
    cellText(String(r.qty), c2 + pad, ry + rh / 2, 9.5, 600, C.ink);
  });
}

// ---------- main loop ----------
let fpsAcc = 0, fpsN = 0, fpsT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (video.readyState < 2 || !video.videoWidth) return;
  const dt = Math.min(0.1, (now - (last || now)) / 1000);
  last = now;
  fpsAcc += dt; fpsN++;
  if (now - fpsT > 500) { status.fps = Math.round(fpsN / Math.max(fpsAcc, 1e-3)); fpsAcc = 0; fpsN = 0; fpsT = now; renderHud(); }

  if (detector && now - lastDet > 70) {
    lastDet = now;
    try { updateTracks(detector.detectForVideo(video, now).detections || [], now); } catch (e) { /* skip frame */ }
  }
  const k = 1 - Math.exp(-dt * 12);
  for (const t of tracks) {
    for (const key of ["x", "y", "w", "h"]) t.box[key] = lerp(t.box[key], t.target[key], k);
    const spec = SPEC[t.cls];
    let mmPerPx;
    if (spec) mmPerPx = spec[1] / Math.max(1, spec[0] === "w" ? t.target.w : t.target.h);
    else mmPerPx = 400 / video.videoHeight;
    const tw = t.target.w * mmPerPx, th = t.target.h * mmPerPx;
    t.wmm = t.wmm ? lerp(t.wmm, tw, 0.12) : tw;
    t.hmm = t.hmm ? lerp(t.hmm, th, 0.12) : th;
  }

  const reveal = ease((now - state.revealStart) / 2300);
  renderGL(now, reveal);

  ctx.drawImage(glc, 0, 0);
  const C = colors();
  const margin = 12 * S, inset = margin + 18 * S;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, reveal * H);
  ctx.clip();
  drawFrame(C, margin, inset);
  const visible = tracks.filter((t) => now - t.born > 120).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h).slice(0, 4);
  for (const t of visible) drawTrack(t, now, C, inset);
  drawNotes(C, inset);
  drawBOM(C, inset, visible);
  drawTitleBlock(C, inset, now);
  ctx.restore();

  if (reveal > 0.001 && reveal < 0.999) {
    ctx.font = font(11, 700);
    ctx.fillStyle = "#bff0ff";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`DRAFTING… ${Math.round(reveal * 100)}%`, W - 20 * S, reveal * H - 6 * S);
  }
}

function renderHud() {
  $("#hud").textContent = `CAM ${status.cam} · DETECT ${status.det} · DEPTH ${status.depth} · ${status.fps} FPS`;
}

// ---------- controls ----------
function wipe(delay = 400) { state.revealStart = performance.now() + delay; }
function setMode(m) {
  state.mode = m;
  $("#mode").textContent = m === 0 ? "◐ BLUEPRINT" : "◑ REDLINE";
}
function toggleDepth() {
  state.depthOn = !state.depthOn;
  $("#depth").textContent = state.depthOn ? "DEPTH ON" : "DEPTH OFF";
  $("#depth").classList.toggle("on", state.depthOn);
}
async function flip() {
  state.facing = state.facing === "user" ? "environment" : "user";
  try { await startCam(); } catch (e) { console.warn(e); }
  tracks = [];
  wipe(200);
}
function pickMime() {
  const c = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}
function toggleRec() {
  if (rec) { rec.stop(); return; }
  if (!window.MediaRecorder) { alert("Recording isn't supported in this browser."); return; }
  recMime = pickMime();
  const s = out.captureStream(30);
  rec = new MediaRecorder(s, recMime ? { mimeType: recMime, videoBitsPerSecond: 14e6 } : { videoBitsPerSecond: 14e6 });
  chunks = [];
  rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const type = recMime || "video/webm";
    const blob = new Blob(chunks, { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `blueprint-vision-${Date.now()}.${type.includes("mp4") ? "mp4" : "webm"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    rec = null;
    $("#rec").classList.remove("live");
    $("#rec").textContent = "● REC";
  };
  rec.start(250);
  $("#rec").classList.add("live");
  $("#rec").textContent = "■ STOP";
  // every clip opens on raw camera, then wipes into the drawing
  state.revealStart = performance.now() + 900;
}
function toggleHide() {
  state.hidden = !state.hidden;
  document.body.classList.toggle("hidden", state.hidden);
}

$("#mode").onclick = () => setMode(state.mode ? 0 : 1);
$("#depth").onclick = toggleDepth;
$("#wipe").onclick = () => wipe(300);
$("#flip").onclick = flip;
$("#rec").onclick = toggleRec;
$("#hide").onclick = toggleHide;
$("#ink").oninput = (e) => (state.thresh = parseFloat(e.target.value));
out.addEventListener("click", () => { if (state.hidden) toggleHide(); });
addEventListener("keydown", (e) => {
  if (!running) return;
  const k = e.key.toLowerCase();
  if (k === "m") setMode(state.mode ? 0 : 1);
  else if (k === "d") toggleDepth();
  else if (k === " ") { e.preventDefault(); wipe(300); }
  else if (k === "r") toggleRec();
  else if (k === "h") toggleHide();
  else if (k === "f") flip();
});

$("#start").onclick = async () => {
  $("#err").textContent = "";
  try {
    initGL();
    await startCam();
  } catch (e) {
    $("#err").textContent = e && e.name === "NotAllowedError" ? "Camera permission denied." : String(e.message || e);
    return;
  }
  try { await document.fonts.load(font(14, 700)); } catch {}
  $("#splash").classList.add("gone");
  running = true;
  renderHud();
  wipe(700);
  requestAnimationFrame(frame);
  initDetector();
  initDepth();
};
