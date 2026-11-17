// Port of the LungMask (R231) pre- and post-processing around the ONNX U-Net.
// The network itself runs through ONNX Runtime (Node or Web); `ort` and `session` are injected.
import { label6 } from './morph.js';

const R = 256; // network input size

const nearestIdx = (i, nIn, nOut) => Math.round((i * (nIn - 1)) / (nOut - 1));

// ---- tiny 2D binary morphology (cross structure, outside = 0 for erosion) ----------------
function dilate2(a, H, W) {
  const o = new Uint8Array(a.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    o[i] = a[i] || (x > 0 && a[i - 1]) || (x < W - 1 && a[i + 1]) || (y > 0 && a[i - W]) || (y < H - 1 && a[i + W]) ? 1 : 0;
  }
  return o;
}
function erode2(a, H, W) {
  const o = new Uint8Array(a.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    o[i] = a[i] && x > 0 && a[i - 1] && x < W - 1 && a[i + 1] && y > 0 && a[i - W] && y < H - 1 && a[i + W] ? 1 : 0;
  }
  return o;
}
function fillHoles8(a, H, W) {
  const bg = new Uint8Array(a.length), st = [];
  const seed = (i) => { if (!a[i] && !bg[i]) { bg[i] = 1; st.push(i); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (st.length) {
    const i = st.pop(), y = (i / W) | 0, x = i - y * W;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < H && xx >= 0 && xx < W) seed(yy * W + xx);
    }
  }
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = bg[i] ? 0 : 1;
  return o;
}
function largest4(a, H, W) {
  const lab = new Int32Array(a.length), st = [], counts = [0];
  let n = 0;
  for (let s = 0; s < a.length; s++) {
    if (!a[s] || lab[s]) continue;
    n++; let c = 0; lab[s] = n; st.push(s);
    while (st.length) {
      const i = st.pop(); c++;
      const y = (i / W) | 0, x = i - y * W;
      if (x > 0 && a[i - 1] && !lab[i - 1]) { lab[i - 1] = n; st.push(i - 1); }
      if (x < W - 1 && a[i + 1] && !lab[i + 1]) { lab[i + 1] = n; st.push(i + 1); }
      if (y > 0 && a[i - W] && !lab[i - W]) { lab[i - W] = n; st.push(i - W); }
      if (y < H - 1 && a[i + W] && !lab[i + W]) { lab[i + W] = n; st.push(i + W); }
    }
    counts.push(c);
  }
  if (!n) return new Uint8Array(a.length);
  let best = 1; for (let k = 2; k <= n; k++) if (counts[k] > counts[best]) best = k;
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = lab[i] === best ? 1 : 0;
  return o;
}

/** Bounding box [r0,c0,r1,c1] of the body in one slice (clipped HU), as LungMask's simple_bodymask. */
function bodyBox(img, H, W) {
  const S = 128, small = new Uint8Array(S * S);
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++)
    small[i * S + j] = img[nearestIdx(i, H, S) * W + nearestIdx(j, W, S)] > -500 ? 1 : 0;
  let m = erode2(dilate2(small, S, S), S, S);          // closing
  m = fillHoles8(m, S, S);
  m = erode2(erode2(m, S, S), S, S);
  m = largest4(m, S, S);
  m = dilate2(dilate2(m, S, S), S, S);
  let r0 = H, c0 = W, r1 = 0, c1 = 0, any = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (m[nearestIdx(y, S, H) * S + nearestIdx(x, S, W)]) {
        any = true; if (y < r0) r0 = y; if (y >= r1) r1 = y + 1; if (x < c0) c0 = x; if (x >= c1) c1 = x + 1;
      }
    }
  }
  return any ? [r0, c0, r1, c1] : [0, 0, H, W];
}

/** Clip, crop to the body, bilinear-resize each slice to 256x256, scale to [0,1]. */
export function preprocessVolume(vol, dims) {
  const [nz, H, W] = dims, out = new Float32Array(nz * R * R), boxes = [];
  const img = new Float32Array(H * W);
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < H * W; i++) { const v = vol[k * H * W + i]; img[i] = v < -1024 ? -1024 : v > 600 ? 600 : v; }
    const box = bodyBox(img, H, W); boxes.push(box);
    const [r0, c0, r1, c1] = box, h = r1 - r0, w = c1 - c0;
    for (let i = 0; i < R; i++) {
      const fy = (i * (h - 1)) / (R - 1), y0 = Math.floor(fy), y1 = Math.min(y0 + 1, h - 1), ty = fy - y0;
      for (let j = 0; j < R; j++) {
        const fx = (j * (w - 1)) / (R - 1), x0 = Math.floor(fx), x1 = Math.min(x0 + 1, w - 1), tx = fx - x0;
        const a = img[(r0 + y0) * W + c0 + x0], b = img[(r0 + y0) * W + c0 + x1];
        const c = img[(r0 + y1) * W + c0 + x0], d = img[(r0 + y1) * W + c0 + x1];
        out[k * R * R + i * R + j] = ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty + 1024) / 1624;
      }
    }
  }
  return { input: out, boxes };
}

export function argmaxLogits(logits, B) {
  const P = R * R, o = new Uint8Array(B * P);
  for (let b = 0; b < B; b++) for (let p = 0; p < P; p++) {
    const i = b * 3 * P + p, a = logits[i], c1 = logits[i + P], c2 = logits[i + 2 * P];
    o[b * P + p] = a >= c1 && a >= c2 ? 0 : c1 >= c2 ? 1 : 2;
  }
  return o;
}

/** Per class: keep the largest 26-connected component, fill 3D voids. */
function cleanClass(pred, nz, cls) {
  const n = pred.length, dims = [nz, R, R], m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = pred[i] === cls ? 1 : 0;
  const { lab, n: nl } = label6(m, dims);          // 6-connectivity (LungMask uses 26; difference is negligible)
  if (!nl) return m;
  const cnt = new Int32Array(nl + 1);
  for (let i = 0; i < n; i++) cnt[lab[i]]++;
  cnt[0] = 0; let best = 1; for (let k = 2; k <= nl; k++) if (cnt[k] > cnt[best]) best = k;
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) keep[i] = lab[i] === best ? 1 : 0;
  // fill voids: background components that do not touch the volume border
  const inv = new Uint8Array(n);
  for (let i = 0; i < n; i++) inv[i] = keep[i] ? 0 : 1;
  const { lab: bl, n: bn } = label6(inv, dims);
  const border = new Uint8Array(bn + 1), sl = R * R;
  for (let z = 0; z < nz; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    if (z === 0 || z === nz - 1 || y === 0 || y === R - 1 || x === 0 || x === R - 1) border[bl[z * sl + y * R + x]] = 1;
  }
  for (let i = 0; i < n; i++) if (!keep[i] && !border[bl[i]]) keep[i] = 1;
  return keep;
}

/** Network class map (nz,256,256) -> lung mask (nz,H,W): 0 background, 1 and 2 the two lungs. */
export function postprocess(pred, boxes, dims) {
  const [nz, H, W] = dims, P = R * R;
  const c1 = cleanClass(pred, nz, 1), c2 = cleanClass(pred, nz, 2);
  const out = new Uint8Array(nz * H * W);
  for (let k = 0; k < nz; k++) {
    const [r0, c0, r1, c1b] = boxes[k], h = r1 - r0, w = c1b - c0;
    for (let y = 0; y < h; y++) {
      const sy = nearestIdx(y, R, h);
      for (let x = 0; x < w; x++) {
        const s = k * P + sy * R + nearestIdx(x, R, w);
        out[k * H * W + (r0 + y) * W + c0 + x] = c1[s] ? 1 : c2[s] ? 2 : 0;
      }
    }
  }
  return out;
}

/** Full pipeline. `ort` is onnxruntime-node or onnxruntime-web; `session` an InferenceSession for r231.onnx. */
export async function runLungMask(ort, session, vol, dims, { batch = 8, onProgress } = {}) {
  const [nz] = dims, P = R * R;
  const { input, boxes } = preprocessVolume(vol, dims);
  const pred = new Uint8Array(nz * P);
  for (let k = 0; k < nz; k += batch) {
    const B = Math.min(batch, nz - k);
    const x = new ort.Tensor('float32', input.subarray(k * P, (k + B) * P), [B, 1, R, R]);
    const y = (await session.run({ slice: x })).logits.data;
    pred.set(argmaxLogits(y, B), k * P);
    if (onProgress) onProgress(Math.min(k + B, nz), nz);
  }
  return postprocess(pred, boxes, dims);
}
