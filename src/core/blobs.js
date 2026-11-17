// Candidate finder: dense blobs inside the lung mask, vessels removed, touching structures split.
// Port of finder/finder.py (find_candidates with a learned lung mask).
import { openBall, dilateBall, edtSq, gauss3, peakLocalMax, watershed } from './morph.js';

export const DS = 2; // in-plane downsampling factor

/** Block-mean downsample in-plane by DS. Returns {v: Float32Array, dims}. */
export function downsample(vol, dims) {
  const [nz, H, W] = dims, h = Math.floor(H / DS), w = Math.floor(W / DS);
  const v = new Float32Array(nz * h * w);
  for (let z = 0; z < nz; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let dy = 0; dy < DS; dy++) for (let dx = 0; dx < DS; dx++) s += vol[(z * H + y * DS + dy) * W + x * DS + dx];
    v[(z * h + y) * w + x] = s / (DS * DS);
  }
  return { v, dims: [nz, h, w] };
}

/** Subsample a full-resolution lung mask (any value > 0 is lung) onto the downsampled grid. */
export function lungToGrid(mask, dims) {
  const [nz, H, W] = dims, h = Math.floor(H / DS), w = Math.floor(W / DS), o = new Uint8Array(nz * h * w);
  for (let z = 0; z < nz; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    o[(z * h + y) * w + x] = mask[(z * H + y * DS) * W + x * DS] > 0 ? 1 : 0;
  return o;
}

function eig3sym(a, b, c, d, e, f) {
  // symmetric [[a,d,e],[d,b,f],[e,f,c]]; eigenvalues, ascending
  const p1 = d * d + e * e + f * f;
  if (p1 < 1e-18) return [a, b, c].sort((x, y) => x - y);
  const q = (a + b + c) / 3, p2 = (a - q) ** 2 + (b - q) ** 2 + (c - q) ** 2 + 2 * p1, p = Math.sqrt(p2 / 6);
  const B = [(a - q) / p, d / p, e / p, d / p, (b - q) / p, f / p, e / p, f / p, (c - q) / p];
  const det = B[0] * (B[4] * B[8] - B[5] * B[7]) - B[1] * (B[3] * B[8] - B[5] * B[6]) + B[2] * (B[3] * B[7] - B[4] * B[6]);
  const r = Math.max(-1, Math.min(1, det / 2)), phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi), e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  return [e3, 3 * q - e1 - e3, e1];
}

/**
 * @param vol     Int16Array HU volume (full resolution)
 * @param dims    [nz, H, W]
 * @param spacing [dz, dy, dx] in mm
 * @param lung    Uint8Array lung mask on the downsampled grid (see lungToGrid)
 */
export function findCandidates(vol, dims, spacing, lung, { minVolMm3 = 100, maxCandidates = 15, debug = false } = {}) {
  const { v, dims: gd } = downsample(vol, dims);
  const sp = [spacing[0], spacing[1] * DS, spacing[2] * DS], n = v.length;
  const [nz, ny, nx] = gd, sl = ny * nx;

  const dense = new Uint8Array(n);
  for (let i = 0; i < n; i++) dense[i] = lung[i] && v[i] > -500 ? 1 : 0;
  const opened = openBall(dense, gd, 4);

  // thickness map, smoothed
  const d2 = edtSq(opened, gd, sp);
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = Math.sqrt(d2[i]);
  const distS = gauss3(dist, gd, 1.0);
  const masked = new Float32Array(n);
  for (let i = 0; i < n; i++) masked[i] = opened[i] ? distS[i] : 0;
  const peaks = peakLocalMax(masked, gd, Math.round(8 / sp[1]), 3.0);

  // split into blobs with a marker-controlled watershed on thickness
  const regionMask = dilateBall(opened, gd, 4);
  for (let i = 0; i < n; i++) regionMask[i] = regionMask[i] && dense[i] ? 1 : 0;
  const neg = new Float32Array(n);
  for (let i = 0; i < n; i++) neg[i] = -distS[i];
  const lab = watershed(neg, peaks, regionMask, gd);
  const nearAir = dilateBall(lung, gd, 1);

  // per-blob statistics in one pass
  const K = peaks.length + 1;
  const cnt = new Float64Array(K), sum = new Float64Array(K * 3), sq = new Float64Array(K * 6);
  const surf = new Float64Array(K), contact = new Float64Array(K);
  const box = new Int32Array(K * 6); for (let k = 0; k < K; k++) { box[k * 6] = box[k * 6 + 2] = box[k * 6 + 4] = 1 << 30; box[k * 6 + 1] = box[k * 6 + 3] = box[k * 6 + 5] = -1; }
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = z * sl + y * nx + x, l = lab[i];
    if (!l) continue;
    const pz = z * sp[0], py = y * sp[1], px = x * sp[2];
    cnt[l]++; sum[l * 3] += pz; sum[l * 3 + 1] += py; sum[l * 3 + 2] += px;
    sq[l * 6] += pz * pz; sq[l * 6 + 1] += py * py; sq[l * 6 + 2] += px * px;
    sq[l * 6 + 3] += pz * py; sq[l * 6 + 4] += pz * px; sq[l * 6 + 5] += py * px;
    const b = l * 6;
    if (z < box[b]) box[b] = z; if (z > box[b + 1]) box[b + 1] = z;
    if (y < box[b + 2]) box[b + 2] = y; if (y > box[b + 3]) box[b + 3] = y;
    if (x < box[b + 4]) box[b + 4] = x; if (x > box[b + 5]) box[b + 5] = x;
    const edge = z === 0 || lab[i - sl] !== l || z === nz - 1 || lab[i + sl] !== l ||
      y === 0 || lab[i - nx] !== l || y === ny - 1 || lab[i + nx] !== l ||
      x === 0 || lab[i - 1] !== l || x === nx - 1 || lab[i + 1] !== l;
    if (edge) { surf[l]++; if (nearAir[i]) contact[l]++; }
  }

  const voxMm3 = sp[0] * sp[1] * sp[2], cands = [];
  for (let l = 1; l < K; l++) {
    const volMm3 = cnt[l] * voxMm3;
    if (volMm3 < minVolMm3) continue;
    const m = [sum[l * 3] / cnt[l], sum[l * 3 + 1] / cnt[l], sum[l * 3 + 2] / cnt[l]], N = cnt[l];
    const cov = (sab, ma, mb) => (sab - N * ma * mb) / Math.max(N - 1, 1);
    const w = eig3sym(cov(sq[l * 6], m[0], m[0]), cov(sq[l * 6 + 1], m[1], m[1]), cov(sq[l * 6 + 2], m[2], m[2]),
      cov(sq[l * 6 + 3], m[0], m[1]), cov(sq[l * 6 + 4], m[0], m[2]), cov(sq[l * 6 + 5], m[1], m[2]));
    const elong = Math.sqrt(w[2] / Math.max(w[0], 1e-6));
    const contactRatio = contact[l] / Math.max(surf[l], 1);
    cands.push({
      label: l, volume_mm3: volMm3, elongation: elong, lung_contact: contactRatio,
      score: Math.log(volMm3) + 3 * contactRatio - 0.8 * Math.log(elong),
      centroid_vox: [m[0] / sp[0], m[1] / sp[1], m[2] / sp[2]],
      bbox: [box[l * 6], box[l * 6 + 1], box[l * 6 + 2], box[l * 6 + 3], box[l * 6 + 4], box[l * 6 + 5]],
    });
  }
  cands.sort((a, b) => b.score - a.score);
  const top = cands.slice(0, maxCandidates).map((c, r) => ({ ...c, rank: r + 1 }));
  const rankOf = new Uint8Array(K); top.forEach((c) => { rankOf[c.label] = c.rank; });
  const labels = new Uint8Array(n);
  for (let i = 0; i < n; i++) labels[i] = lab[i] ? rankOf[lab[i]] : 0;
  return { candidates: top, labels, dims: gd, spacing: sp, debug: debug ? { opened, distS, peaks, lab } : undefined };
}
