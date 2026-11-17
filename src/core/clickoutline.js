// Click-to-outline v2: grow a 3D outline from one click. Plain JavaScript, no dependencies beyond morph.js.
// Works on the downsampled grid (see blobs.js).
//
// What changed from v1 (see notes/opus_report.md for the evaluation):
//  - The growth limit is the convex hull of each lung, per slice and per side (left/right), instead of the
//    raw learned lung mask. The learned mask cuts out tumours that touch the pleura or mediastinum; its hull
//    puts them back while still excluding the chest wall.
//  - Two levels: a dense core (coreT) is opened to cut vessels and attachments, then the outline grows back
//    up to shellMm into the softer edge (t). This keeps hazy edges without following every attachment.
//  - Settings are chosen automatically from the image under the click (no expert data):
//      opening radius  ~ a fraction of the core's own thickness (distance-map peak climbed from the click),
//      search radius   ~ a multiple of that thickness, centred on the tumour rather than the click.
//  - `t` and `radiusMm` stay as the drag controls: the result reports the automatic radius, so the UI can
//    start a drag from it; passing numbers overrides the automatic values.
import { label6, gauss3, fillHoles2D, edtSq } from './morph.js';

// ---- defaults chosen on the tuning half of the patients (see notes/opus_report.md) ----
export const DEFAULTS = {
  t: 0.5,          // tolerance: threshold = lungHU + t * (seedHU - lungHU)
  maxRadiusMm: 80, // hard cap on the search ball around the click
  openFrac: 0.7,   // opening radius = openFrac * tumour thickness (inscribed radius), in mm
  openMinMm: 1.5,
  openMaxMm: 6,
  ballFrac: 2.5,   // search ball radius around the tumour centre = ballFrac * inscribed radius + ballAddMm
  ballAddMm: 8,
  seedRadiusMm: 4, // neighbourhood used to read the tumour intensity under the click
  seedPct: 0.75,   // percentile of that neighbourhood (robust to clicks near the edge)
  coreT: 0.9,      // tolerance for the dense tumour core (null = same as t); the core is opened, then grown back
  shellMm: 10,     // how far the outline may grow back from the core, within the t threshold
};

function quantile(a, q) {
  if (!a.length) return NaN;
  const s = Float32Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

// ---- per-slice, per-side convex hull of the lung mask (cached per mask array) ----
const hullCache = new WeakMap();

function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }

function fillConvex(pts, out, ny, nx, off) {
  // pts: [x, y] points; fill their convex hull into out (slice at offset off)
  if (pts.length < 3) return;
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const h = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (h.length < 3) return;
  let y0 = ny, y1 = -1;
  for (const p of h) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  for (let y = y0; y <= y1; y++) {
    let xa = Infinity, xb = -Infinity;
    for (let k = 0; k < h.length; k++) {
      const p = h[k], q = h[(k + 1) % h.length];
      if ((p[1] <= y && q[1] >= y) || (q[1] <= y && p[1] >= y)) {
        if (p[1] === q[1]) { xa = Math.min(xa, p[0], q[0]); xb = Math.max(xb, p[0], q[0]); }
        else { const x = p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]); xa = Math.min(xa, x); xb = Math.max(xb, x); }
      }
    }
    for (let x = Math.max(0, Math.ceil(xa - 1e-6)); x <= Math.min(nx - 1, Math.floor(xb + 1e-6)); x++) out[off + y * nx + x] = 1;
  }
}

/** Convex hull of the lung mask on each axial slice, separately for each side (split at the midline
 *  between the two lungs). Covers tumours the learned mask leaves out at the pleura and mediastinum. */
export function lungHull(lung, dims) {
  const hit = hullCache.get(lung);
  if (hit) return hit;
  const [nz, ny, nx] = dims, sl = ny * nx, out = new Uint8Array(lung.length);
  // midline: mean x of all lung voxels
  let sx = 0, n = 0;
  for (let i = 0; i < lung.length; i++) if (lung[i]) { sx += i % nx; n++; }
  const mid = n ? sx / n : nx / 2;
  for (let z = 0; z < nz; z++) {
    const off = z * sl, L = [], R = [];
    for (let y = 0; y < ny; y++) {
      // only row end points are needed for the hull
      let la = -1, lb = -1, ra = -1, rb = -1;
      for (let x = 0; x < nx; x++) if (lung[off + y * nx + x]) {
        if (x < mid) { if (la < 0) la = x; lb = x; } else { if (ra < 0) ra = x; rb = x; }
      }
      if (la >= 0) { L.push([la, y]); if (lb !== la) L.push([lb, y]); }
      if (ra >= 0) { R.push([ra, y]); if (rb !== ra) R.push([rb, y]); }
    }
    fillConvex(L, out, ny, nx, off);
    fillConvex(R, out, ny, nx, off);
  }
  hullCache.set(lung, out);
  return out;
}

// opening / dilation with a ball of radius rMm (anisotropic voxels)
function erodeMm(mask, dims, sp, rMm) {
  const d = edtSq(mask, dims, sp), out = new Uint8Array(mask.length), r2 = rMm * rMm;
  for (let i = 0; i < mask.length; i++) out[i] = d[i] > r2 ? 1 : 0;
  return out;
}
function dilateMm(mask, dims, sp, rMm) {
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = edtSq(inv, dims, sp), out = new Uint8Array(mask.length), r2 = rMm * rMm;
  for (let i = 0; i < mask.length; i++) out[i] = d[i] <= r2 ? 1 : 0;
  return out;
}

/**
 * @param v       Float32Array HU volume on the grid
 * @param dims    [nz, ny, nx]
 * @param sp      voxel spacing in mm [dz, dy, dx]
 * @param lung    Uint8Array lung mask on the grid (learned; may miss attached tumours)
 * @param seed    [z, y, x] clicked voxel
 * @param opts    t (tolerance 0..1, lower = more inclusive), radiusMm (search ball around the tumour centre;
 *                default automatic), openR (opening radius in voxels; default automatic), useLung (limit
 *                growth to the lung hull; default true), limit ('hull' | 'mask'; 'mask' is the v1 limit),
 *                stats (also return unsupervised outline descriptors), plus any key of DEFAULTS
 * @returns {mask: Uint8Array(grid), voxels, seedHU, lungHU, threshold, radiusMm (search ball used),
 *           openMm, thickMm (core inscribed radius), stats?}
 */
export function outlineFromClick(v, dims, sp, lung, seed, opts = {}) {
  const P = { ...DEFAULTS, ...opts };
  const { t, useLung = true, limit = 'hull' } = P;
  const [nz, ny, nx] = dims;
  const userRadius = typeof opts.radiusMm === 'number';
  const R0 = Math.max(P.maxRadiusMm, userRadius ? opts.radiusMm + 20 : 0); // region read around the click
  const region = useLung ? (limit === 'mask' ? lung : lungHull(lung, dims)) : null;

  const lo = [0, 1, 2].map((a) => Math.max(0, seed[a] - Math.ceil(R0 / sp[a])));
  const hi = [nz, ny, nx].map((n, a) => Math.min(n, seed[a] + Math.ceil(R0 / sp[a]) + 1));
  const rd = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], rn = rd[0] * rd[1] * rd[2], sl = rd[1] * rd[2];
  const crop = new Float32Array(rn), rl = new Uint8Array(rn), inBall = new Uint8Array(rn), lungIn = new Uint8Array(rn);
  const rs = [seed[0] - lo[0], seed[1] - lo[1], seed[2] - lo[2]];
  for (let z = 0; z < rd[0]; z++) for (let y = 0; y < rd[1]; y++) for (let x = 0; x < rd[2]; x++) {
    const i = z * sl + y * rd[2] + x, g = ((z + lo[0]) * ny + y + lo[1]) * nx + x + lo[2];
    crop[i] = v[g]; rl[i] = region ? region[g] : 1; lungIn[i] = lung[g];
    const dzm = (z - rs[0]) * sp[0], dym = (y - rs[1]) * sp[1], dxm = (x - rs[2]) * sp[2];
    inBall[i] = dzm * dzm + dym * dym + dxm * dxm <= R0 * R0 ? 1 : 0;
  }
  const sm = gauss3(crop, rd, 1.0);
  const sIdx = rs[0] * sl + rs[1] * rd[2] + rs[2];

  // tumour intensity under the click, and the surrounding lung
  const near = [], rS2 = P.seedRadiusMm * P.seedRadiusMm;
  const w = [0, 1, 2].map((a) => Math.ceil(P.seedRadiusMm / sp[a]));
  for (let z = Math.max(0, rs[0] - w[0]); z <= Math.min(rd[0] - 1, rs[0] + w[0]); z++)
    for (let y = Math.max(0, rs[1] - w[1]); y <= Math.min(rd[1] - 1, rs[1] + w[1]); y++)
      for (let x = Math.max(0, rs[2] - w[2]); x <= Math.min(rd[2] - 1, rs[2] + w[2]); x++) {
        const dzm = (z - rs[0]) * sp[0], dym = (y - rs[1]) * sp[1], dxm = (x - rs[2]) * sp[2];
        if (dzm * dzm + dym * dym + dxm * dxm <= rS2) near.push(sm[z * sl + y * rd[2] + x]);
      }
  const seedHU = Math.max(sm[sIdx], quantile(near, P.seedPct));
  const air = [];
  for (let i = 0; i < rn; i++) if (lungIn[i] && sm[i] < -500) air.push(sm[i]);
  const lungHU = air.length > 200 ? quantile(air, 0.5) : -850;
  const threshold = lungHU + t * (seedHU - lungHU);
  const result = { mask: new Uint8Array(v.length), voxels: 0, seedHU, lungHU, threshold, radiusMm: R0, openMm: 0, thickMm: 0 };
  if (!(seedHU > lungHU + 100)) return result; // clicked on air or very faint tissue

  const cand = new Uint8Array(rn), core = new Uint8Array(rn);
  const coreThr = P.coreT == null ? threshold : lungHU + Math.max(t, P.coreT) * (seedHU - lungHU);
  for (let i = 0; i < rn; i++) {
    cand[i] = inBall[i] && rl[i] && sm[i] > threshold ? 1 : 0;
    core[i] = cand[i] && sm[i] > coreThr ? 1 : 0;
  }

  // click just outside the core: nearest core voxel within 5 mm; if none, fall back to a single level
  const nearestCore = () => {
    if (core[sIdx]) return sIdx;
    let best = 25, c = -1;
    const ww = [0, 1, 2].map((a) => Math.ceil(5 / sp[a]));
    for (let z = Math.max(0, rs[0] - ww[0]); z <= Math.min(rd[0] - 1, rs[0] + ww[0]); z++)
      for (let y = Math.max(0, rs[1] - ww[1]); y <= Math.min(rd[1] - 1, rs[1] + ww[1]); y++)
        for (let x = Math.max(0, rs[2] - ww[2]); x <= Math.min(rd[2] - 1, rs[2] + ww[2]); x++) {
          const i = z * sl + y * rd[2] + x;
          const d = ((z - rs[0]) * sp[0]) ** 2 + ((y - rs[1]) * sp[1]) ** 2 + ((x - rs[2]) * sp[2]) ** 2;
          if (core[i] && d < best) { best = d; c = i; }
        }
    return c;
  };
  let c = nearestCore();
  if (c < 0 && coreThr > threshold) { core.set(cand); c = nearestCore(); }
  if (c < 0) return result;
  // tumour thickness: climb the distance map from the click to its local peak
  const dist = edtSq(core, rd, sp);
  for (;;) { // steepest ascent on the 26-neighbourhood
    const z = (c / sl) | 0, y = ((c - z * sl) / rd[2]) | 0, x = c - z * sl - y * rd[2];
    let bi = c, bv = dist[c];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const zz = z + dz, yy = y + dy, xx = x + dx;
      if (zz < 0 || yy < 0 || xx < 0 || zz >= rd[0] || yy >= rd[1] || xx >= rd[2]) continue;
      const j = zz * sl + yy * rd[2] + xx;
      if (dist[j] > bv) { bv = dist[j]; bi = j; }
    }
    if (bi === c) break;
    c = bi;
  }
  const thick = Math.sqrt(dist[c]);
  const cz = (c / sl) | 0, cy = ((c - cz * sl) / rd[2]) | 0, cx = c - cz * sl - cy * rd[2];

  // search ball around the tumour centre, sized by its thickness (or the user's radius when dragging)
  const Rb = userRadius ? opts.radiusMm : Math.min(R0, P.ballFrac * thick + P.ballAddMm);
  {
    for (let z = 0; z < rd[0]; z++) for (let y = 0; y < rd[1]; y++) for (let x = 0; x < rd[2]; x++) {
      const i = z * sl + y * rd[2] + x;
      if (!cand[i]) continue;
      const d = ((z - cz) * sp[0]) ** 2 + ((y - cy) * sp[1]) ** 2 + ((x - cx) * sp[2]) ** 2;
      if (d > Rb * Rb) { cand[i] = 0; core[i] = 0; }
    }
  }

  // work in the box around the search ball only (faster)
  const cc = [cz, cy, cx];
  const b0 = [0, 1, 2].map((a) => Math.max(0, cc[a] - Math.ceil((Rb + 1) / sp[a])));
  const b1 = [0, 1, 2].map((a) => Math.min(rd[a], cc[a] + Math.ceil((Rb + 1) / sp[a]) + 1));
  const bd = [b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]], bn = bd[0] * bd[1] * bd[2], bsl = bd[1] * bd[2];
  const bc = new Uint8Array(bn), bk = new Uint8Array(bn);
  for (let z = 0; z < bd[0]; z++) for (let y = 0; y < bd[1]; y++) for (let x = 0; x < bd[2]; x++) {
    const i = z * bsl + y * bd[2] + x, j = (z + b0[0]) * sl + (y + b0[1]) * rd[2] + x + b0[2];
    bc[i] = cand[j]; bk[i] = core[j];
  }
  const bIdx = (zz, yy, xx) => (zz - b0[0]) * bsl + (yy - b0[1]) * bd[2] + xx - b0[2];
  const ci = bIdx(cz, cy, cx);
  const inBox = rs.every((q, a) => q >= b0[a] && q < b1[a]);
  const si = inBox ? bIdx(rs[0], rs[1], rs[2]) : -1;

  // cut vessels and thin attachments with an opening scaled to the tumour, keep the part under the click
  const vox = Math.cbrt(sp[0] * sp[1] * sp[2]);
  const openMm = typeof opts.openR === 'number' ? opts.openR * vox
    : Math.min(P.openMaxMm, Math.max(P.openMinMm, P.openFrac * thick));
  // never open wider than the core itself (tiny nodules would vanish)
  const openEff = Math.min(openMm, 0.8 * thick);
  let opened = bk;
  if (openEff >= 1) {
    opened = dilateMm(erodeMm(bk, bd, sp, openEff), bd, sp, openEff);
    for (let i = 0; i < bn; i++) opened[i] = opened[i] && bk[i] ? 1 : 0;
  }
  const { lab } = label6(opened, bd);
  let keepLabel = lab[ci];
  if (!keepLabel) { // thin part: nearest opened component within 10 mm
    let best = 1e9;
    for (let z = 0; z < bd[0]; z++) for (let y = 0; y < bd[1]; y++) for (let x = 0; x < bd[2]; x++) {
      const i = z * bsl + y * bd[2] + x;
      if (lab[i]) {
        const d = ((z + b0[0] - cz) * sp[0]) ** 2 + ((y + b0[1] - cy) * sp[1]) ** 2 + ((x + b0[2] - cx) * sp[2]) ** 2;
        if (d < best) { best = d; keepLabel = lab[i]; }
      }
    }
    if (best > 100) return result;
  }
  const comp = new Uint8Array(bn);
  for (let i = 0; i < bn; i++) comp[i] = lab[i] === keepLabel ? 1 : 0;
  // grow back toward the original edge (within the low threshold), then fill holes slice by slice
  const shell = P.shellMm == null ? openMm : P.shellMm;
  const grown = shell > 0 ? dilateMm(comp, bd, sp, shell) : comp;
  for (let i = 0; i < bn; i++) grown[i] = grown[i] && bc[i] ? 1 : 0;
  // keep only what is connected to the core (the grow-back can touch neighbours)
  const { lab: lab2 } = label6(grown, bd);
  const k2 = lab2[ci] || (si >= 0 ? lab2[si] : 0);
  if (k2) for (let i = 0; i < bn; i++) grown[i] = lab2[i] === k2 ? 1 : 0;
  const filled = fillHoles2D(grown, bd);
  let count = 0;
  for (let z = 0; z < bd[0]; z++) for (let y = 0; y < bd[1]; y++) for (let x = 0; x < bd[2]; x++) {
    if (filled[z * bsl + y * bd[2] + x]) {
      result.mask[((z + b0[0] + lo[0]) * ny + y + b0[1] + lo[1]) * nx + x + b0[2] + lo[2]] = 1; count++;
    }
  }
  Object.assign(result, { voxels: count, radiusMm: Rb, openMm, thickMm: thick });
  if (opts.stats && count) result.stats = outlineStats(filled, bd, b0, rd, sm, cand, lungIn, rl, sp, threshold, seedHU, lungHU, cc, Rb, thick);
  return result;
}

/** Unsupervised descriptors of an outline (no expert data), used to choose between candidate outlines. */
function outlineStats(m, bd, b0, rd, sm, cand, lungIn, region, sp, thr, seedHU, lungHU, cc, Rb, thick) {
  const [bz, by, bx] = bd, bsl = by * bx, sl = rd[1] * rd[2];
  let n = 0, surf = 0, cut = 0, ring = 0, ringHU = 0, inHU = 0, outLung = 0, atBall = 0, atRegion = 0, grad = 0;
  const g = (j, st, h) => (sm[j + st] - sm[j - st]) / (2 * h);
  const nb = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
  for (let z = 0; z < bz; z++) for (let y = 0; y < by; y++) for (let x = 0; x < bx; x++) {
    const i = z * bsl + y * bx + x;
    if (!m[i]) continue;
    const Z = z + b0[0], Y = y + b0[1], X = x + b0[2], j = Z * sl + Y * rd[2] + X;
    n++; inHU += sm[j]; if (!lungIn[j]) outLung++;
    let isSurf = false;
    for (const [dz, dy, dx] of nb) {
      const zz = z + dz, yy = y + dy, xx = x + dx;
      const inside = zz >= 0 && yy >= 0 && xx >= 0 && zz < bz && yy < by && xx < bx && m[zz * bsl + yy * bx + xx];
      if (inside) continue;
      isSurf = true;
      const ZZ = Z + dz, YY = Y + dy, XX = X + dx;
      if (ZZ < 0 || YY < 0 || XX < 0 || ZZ >= rd[0] || YY >= rd[1] || XX >= rd[2]) continue;
      const k = ZZ * sl + YY * rd[2] + XX;
      ring++; ringHU += sm[k];
      if (sm[k] > thr) { cut++; if (!region[k]) atRegion++; }
    }
    if (isSurf) {
      surf++;
      const d = Math.sqrt(((Z - cc[0]) * sp[0]) ** 2 + ((Y - cc[1]) * sp[1]) ** 2 + ((X - cc[2]) * sp[2]) ** 2);
      if (d > Rb - 2) atBall++;
      if (Z > 0 && Y > 0 && X > 0 && Z < rd[0] - 1 && Y < rd[1] - 1 && X < rd[2] - 1)
        grad += Math.hypot(g(j, sl, sp[0]), g(j, rd[2], sp[1]), g(j, 1, sp[2]));
    }
  }
  const volMl = n * sp[0] * sp[1] * sp[2] / 1000, span = Math.max(seedHU - lungHU, 1);
  return {
    volMl,
    cutFrac: ring ? cut / ring : 0,          // border faces that cut through tissue instead of meeting air
    regionCut: ring ? atRegion / ring : 0,   // border faces stopped only by the lung-hull limit
    ballFrac: surf ? atBall / surf : 0,      // border voxels stopped by the search ball
    contrast: ((inHU / n) - (ring ? ringHU / ring : 0)) / span,
    grad: surf ? grad / surf / span : 0,
    outLung: outLung / n,
    compact: surf / Math.pow(n, 2 / 3),      // ~4.8 for a ball, larger for irregular/leaky shapes
    sizeVsThick: Math.log(volMl * 1000 / ((4 / 3) * Math.PI * Math.max(thick, 1) ** 3)),
  };
}
