// Follow-up matching: given a tumour outlined on a baseline scan, propose where the same tumour is on a
// follow-up scan. Plain JavaScript, no dependencies; works on the downsampled grid (see blobs.js).
// Research use only. The proposal is a seed point: pass it to outlineFromClick() to get an editable outline.
//
// Pipeline (every stage is returned in `stages`, so each can be scored on its own):
//   1. index    : same slice index and pixel.
//   2. geometry : same patient-space position, from the DICOM origins (`origin` of each scan).
//   3. rigid    : rigid registration (translation + rotation about the table axis) of the two lung masks,
//                 coarse-to-fine, maximising the lung overlap inside the shared field of view.
//   4. local    : normalised cross-correlation (NCC) of a patch of the baseline around the tumour against the
//                 follow-up, searched in a window around the rigidly mapped point.
// The proposal is stage 4. `confidence` says when to trust it (see CONF below).

export const MATCH_DEFAULTS = {
  searchMm: 25,       // half-width of the local NCC search window around the rigidly mapped point
  patchMarginMm: 12,  // patch radius = tumour equivalent radius + this margin (context: vessels, pleura)
  patchMinMm: 14,     // smallest patch radius
  patchMaxMm: 28,     // largest patch radius (cost grows with its cube)
  huClip: [-1000, 150],
  useLung: true,      // run the lung-mask registration (stage 3); false = NCC around the geometry position
  // Confidence rule, chosen on the tuning half of the patients only, over all perturbation runs (core/scripts/tune_conf.mjs;
  // see notes/opus_match_report.md). The rigid-shift limit was not selected (set high = off).
  conf: { nccMin: 0.3, marginMin: 0.3, huDiffMax: 150, shiftMaxMm: 1000 },
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const idxOf = (z, y, x, d) => (z * d[1] + y) * d[2] + x;

function maskCentroid(mask, dims) {
  const [nz, ny, nx] = dims; let n = 0, sz = 0, sy = 0, sx = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) { const o = (z * ny + y) * nx; for (let x = 0; x < nx; x++) if (mask[o + x]) { n++; sz += z; sy += y; sx += x; } }
  return n ? { n, c: [sz / n, sy / n, sx / n] } : { n: 0, c: [0, 0, 0] };
}

/** Rigid transform of baseline index space to follow index space, built from the lung masks. */
function lungRegister(B, F, init, opts) {
  // mm position of a voxel: p = idx*sp + origin (patient space). Transform: q = R(p - c) + c + t, R = yaw (y-x plane).
  const spB = B.spacing, spF = F.spacing, oB = B.origin || [0, 0, 0], oF = F.origin || [0, 0, 0];
  const dB = B.dims, dF = F.dims;
  // lung centroid of the baseline (rotation centre), in mm
  const cm = maskCentroid(B.lung, dB);
  if (cm.n < 1000) return { t: [0, 0, 0], yaw: 0, c: [0, 0, 0], score: 0, ok: false };
  const c = [0, 1, 2].map((a) => cm.c[a] * spB[a] + oB[a]);
  // baseline lung points at a stride
  const pts = (step) => {
    const sz = Math.max(1, Math.round(step / spB[0])), sxy = Math.max(1, Math.round(step / spB[1])), out = [];
    for (let z = 0; z < dB[0]; z += sz) for (let y = 0; y < dB[1]; y += sxy) for (let x = 0; x < dB[2]; x += sxy)
      if (B.lung[idxOf(z, y, x, dB)]) out.push([z * spB[0] + oB[0] - c[0], y * spB[1] + oB[1] - c[1], x * spB[2] + oB[2] - c[2]]);
    return out;
  };
  // follow lung count per slice (for the shared-FOV Dice)
  const perSlice = new Float64Array(dF[0]); const sliceN = dF[1] * dF[2];
  for (let z = 0; z < dF[0]; z++) { let s = 0; const o = z * sliceN; for (let i = 0; i < sliceN; i++) s += F.lung[o + i]; perSlice[z] = s; }
  const cum = new Float64Array(dF[0] + 1); for (let z = 0; z < dF[0]; z++) cum[z + 1] = cum[z] + perSlice[z];
  const zLoB = oB[0], zHiB = (dB[0] - 1) * spB[0] + oB[0];
  const score = (P, step, t, yaw) => {
    const cs = Math.cos(yaw), sn = Math.sin(yaw); let ov = 0, nb = 0;
    const tz = t[0], ty = t[1], tx = t[2];
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const qz = p[0] + c[0] + tz, qy = cs * p[1] - sn * p[2] + c[1] + ty, qx = sn * p[1] + cs * p[2] + c[2] + tx;
      const fz = Math.round((qz - oF[0]) / spF[0]), fy = Math.round((qy - oF[1]) / spF[1]), fx = Math.round((qx - oF[2]) / spF[2]);
      if (fz < 0 || fz >= dF[0] || fy < 0 || fy >= dF[1] || fx < 0 || fx >= dF[2]) continue;
      nb++; if (F.lung[(fz * dF[1] + fy) * dF[2] + fx]) ov++;
    }
    // follow lung inside the z range covered by the shifted baseline (slice counts, converted to the same stride)
    const zlo = Math.max(0, Math.ceil((zLoB + tz - oF[0]) / spF[0])), zhi = Math.min(dF[0] - 1, Math.floor((zHiB + tz - oF[0]) / spF[0]));
    const nf = zhi >= zlo ? (cum[zhi + 1] - cum[zlo]) / (step * step * step / (spF[0] * spF[1] * spF[2])) : 0;
    return nb + nf > 0 ? (2 * ov) / (nb + nf) : 0;
  };
  // translation is expressed as follow-minus-baseline mm shift; start from init (mm, usually 0 with geometry)
  const grid = (centre, half, step) => { const o = []; for (let a = -half; a <= half + 1e-6; a += step) o.push(centre + a); return o; };
  let best = { s: -1, t: init.slice(), yaw: 0 };
  const P1 = pts(9);
  for (const dz of grid(init[0], 72, 9)) for (const dy of grid(init[1], 54, 9)) for (const dx of grid(init[2], 54, 9)) {
    const s = score(P1, 9, [dz, dy, dx], 0); if (s > best.s) best = { s, t: [dz, dy, dx], yaw: 0 };
  }
  const P2 = pts(4.5);
  let cur = { ...best, s: -1 };
  for (const yawDeg of [-6, -4, -2, 0, 2, 4, 6]) for (const dz of grid(best.t[0], 9, 3)) for (const dy of grid(best.t[1], 9, 3)) for (const dx of grid(best.t[2], 9, 3)) {
    const s = score(P2, 4.5, [dz, dy, dx], (yawDeg * Math.PI) / 180); if (s > cur.s) cur = { s, t: [dz, dy, dx], yaw: (yawDeg * Math.PI) / 180 };
  }
  const P3 = pts(3);
  let fin = { ...cur, s: -1 };
  for (const dz of grid(cur.t[0], 3, 1.5)) for (const dy of grid(cur.t[1], 3, 1.5)) for (const dx of grid(cur.t[2], 3, 1.5)) for (const da of [-1, 0, 1]) {
    const yaw = cur.yaw + (da * Math.PI) / 180;
    const s = score(P3, 3, [dz, dy, dx], yaw); if (s > fin.s) fin = { s, t: [dz, dy, dx], yaw };
  }
  return { t: fin.t, yaw: fin.yaw, c, score: fin.s, ok: true };
}

/** Map a baseline voxel index (fractional ok) to follow voxel index with the rigid transform. */
function mapIdx(B, F, T, p) {
  const spB = B.spacing, spF = F.spacing, oB = B.origin || [0, 0, 0], oF = F.origin || [0, 0, 0];
  const q0 = p[0] * spB[0] + oB[0] - T.c[0], q1 = p[1] * spB[1] + oB[1] - T.c[1], q2 = p[2] * spB[2] + oB[2] - T.c[2];
  const cs = Math.cos(T.yaw), sn = Math.sin(T.yaw);
  const Z = q0 + T.c[0] + T.t[0], Y = cs * q1 - sn * q2 + T.c[1] + T.t[1], X = sn * q1 + cs * q2 + T.c[2] + T.t[2];
  return [(Z - oF[0]) / spF[0], (Y - oF[1]) / spF[1], (X - oF[2]) / spF[2]];
}

function trilinear(v, d, z, y, x, fill) {
  if (z < 0 || y < 0 || x < 0 || z > d[0] - 1 || y > d[1] - 1 || x > d[2] - 1) return fill;
  const z0 = Math.floor(z), y0 = Math.floor(y), x0 = Math.floor(x);
  const z1 = Math.min(z0 + 1, d[0] - 1), y1 = Math.min(y0 + 1, d[1] - 1), x1 = Math.min(x0 + 1, d[2] - 1);
  const fz = z - z0, fy = y - y0, fx = x - x0, sl = d[1] * d[2], r = d[2];
  const a = (zz, yy, xx) => v[zz * sl + yy * r + xx];
  const c00 = a(z0, y0, x0) * (1 - fx) + a(z0, y0, x1) * fx, c01 = a(z0, y1, x0) * (1 - fx) + a(z0, y1, x1) * fx;
  const c10 = a(z1, y0, x0) * (1 - fx) + a(z1, y0, x1) * fx, c11 = a(z1, y1, x0) * (1 - fx) + a(z1, y1, x1) * fx;
  return (c00 * (1 - fy) + c01 * fy) * (1 - fz) + (c10 * (1 - fy) + c11 * fy) * fz;
}

/** Mean of a small ball (radius mm) of the volume around a voxel (HU), used as a sanity check on the proposed seed. */
function ballMean(v, d, sp, c, rmm) {
  const rz = Math.ceil(rmm / sp[0]), ry = Math.ceil(rmm / sp[1]), rx = Math.ceil(rmm / sp[2]); let s = 0, n = 0;
  for (let dz = -rz; dz <= rz; dz++) for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
    if ((dz * sp[0]) ** 2 + (dy * sp[1]) ** 2 + (dx * sp[2]) ** 2 > rmm * rmm) continue;
    const z = c[0] + dz, y = c[1] + dy, x = c[2] + dx;
    if (z < 0 || y < 0 || x < 0 || z >= d[0] || y >= d[1] || x >= d[2]) continue;
    s += v[idxOf(z, y, x, d)]; n++;
  }
  return n ? s / n : NaN;
}

/** Local NCC refinement. Returns the best shift (baseline-frame voxels) and NCC features. */
function nccRefine(B, F, T, centre, radiusMm, opts) {
  const [lo, hi] = opts.huClip, spB = B.spacing, dB = B.dims;
  const cl = (x) => (x < lo ? lo : x > hi ? hi : x);
  const rv = [0, 1, 2].map((a) => Math.ceil(radiusMm / spB[a]));
  const sv = [0, 1, 2].map((a) => Math.ceil(opts.searchMm / spB[a]));
  const half = [0, 1, 2].map((a) => rv[a] + sv[a]);
  const cI = centre.map(Math.round);
  const wd = half.map((h) => 2 * h + 1);
  // follow window resampled into the baseline frame (so a rotation is handled): W(p) = follow(T(p))
  const W = new Float32Array(wd[0] * wd[1] * wd[2]);
  for (let z = 0; z < wd[0]; z++) for (let y = 0; y < wd[1]; y++) for (let x = 0; x < wd[2]; x++) {
    const q = mapIdx(B, F, T, [cI[0] + z - half[0], cI[1] + y - half[1], cI[2] + x - half[2]]);
    W[(z * wd[1] + y) * wd[2] + x] = cl(trilinear(F.vol, F.dims, q[0], q[1], q[2], lo));
  }
  // patch: voxels of the baseline inside an ellipsoid of radius radiusMm (mm) around the centre
  const patch = (stride) => {
    const off = [], val = [];
    for (let dz = -rv[0]; dz <= rv[0]; dz += stride) for (let dy = -rv[1]; dy <= rv[1]; dy += stride) for (let dx = -rv[2]; dx <= rv[2]; dx += stride) {
      if ((dz * spB[0]) ** 2 + (dy * spB[1]) ** 2 + (dx * spB[2]) ** 2 > radiusMm * radiusMm) continue;
      const z = cI[0] + dz, y = cI[1] + dy, x = cI[2] + dx;
      if (z < 0 || y < 0 || x < 0 || z >= dB[0] || y >= dB[1] || x >= dB[2]) continue;
      off.push(dz, dy, dx); val.push(cl(B.vol[idxOf(z, y, x, dB)]));
    }
    const n = val.length; let m = 0; for (const a of val) m += a; m /= n;
    let ss = 0; const z0 = new Float32Array(n); for (let i = 0; i < n; i++) { z0[i] = val[i] - m; ss += z0[i] * z0[i]; }
    return { off: Int16Array.from(off), z0, n, sd: Math.sqrt(ss) };
  };
  const ncc = (P, dz, dy, dx) => {
    let sf = 0, sff = 0, sfp = 0; const { off, z0, n } = P;
    for (let i = 0; i < n; i++) {
      const f = W[((half[0] + off[3 * i] + dz) * wd[1] + half[1] + off[3 * i + 1] + dy) * wd[2] + half[2] + off[3 * i + 2] + dx];
      sf += f; sff += f * f; sfp += f * z0[i];
    }
    const vf = sff - (sf * sf) / n; if (vf < 1e-6 || P.sd < 1e-6) return -1;
    return sfp / (P.sd * Math.sqrt(vf));
  };
  const S = 2, Pc = patch(S);
  if (Pc.n < 30) return { shift: [0, 0, 0], ncc: -1, second: -1, ok: false };
  // coarse search on a stride-2 lattice, keep the map for the second-peak test
  const mapV = []; let best = { v: -2, s: [0, 0, 0] };
  for (let dz = -sv[0]; dz <= sv[0]; dz += S) for (let dy = -sv[1]; dy <= sv[1]; dy += S) for (let dx = -sv[2]; dx <= sv[2]; dx += S) {
    const v = ncc(Pc, dz, dy, dx); mapV.push([dz, dy, dx, v]); if (v > best.v) best = { v, s: [dz, dy, dx] };
  }
  // second peak: best NCC at least 10 mm (in the baseline frame) away from the best
  let second = -1;
  for (const [dz, dy, dx, v] of mapV) {
    const d2 = ((dz - best.s[0]) * spB[0]) ** 2 + ((dy - best.s[1]) * spB[1]) ** 2 + ((dx - best.s[2]) * spB[2]) ** 2;
    if (d2 > 100 && v > second) second = v;
  }
  // refine at full resolution around the best coarse position
  const Pf = patch(1); let fin = { v: -2, s: best.s };
  for (let dz = best.s[0] - 2; dz <= best.s[0] + 2; dz++) for (let dy = best.s[1] - 2; dy <= best.s[1] + 2; dy++) for (let dx = best.s[2] - 2; dx <= best.s[2] + 2; dx++) {
    if (Math.abs(dz) > sv[0] || Math.abs(dy) > sv[1] || Math.abs(dx) > sv[2]) continue;
    const v = ncc(Pf, dz, dy, dx); if (v > fin.v) fin = { v, s: [dz, dy, dx] };
  }
  const zero = ncc(Pf, 0, 0, 0);
  return { shift: fin.s, ncc: fin.v, second, nccAtZero: zero, ok: true };
}

/**
 * Propose where a baseline tumour is on a follow-up scan.
 * @param baseline {vol: Float32Array|Int16Array (grid HU), dims [nz,ny,nx], spacing [dz,dy,dx] mm, mask: Uint8Array (tumour, grid),
 *                  seed [z,y,x] (the click), lung: Uint8Array (grid), origin?: [z,y,x] mm of voxel (0,0,0) in patient space}
 * @param follow   {vol, dims, spacing, lung, origin?}. Without `origin` on both scans, "same position" means same index.
 * @param opts     see MATCH_DEFAULTS
 * @returns {seed: [z,y,x] on the follow-up grid (feed it to outlineFromClick), confidence: {level: 'Confident'|'Uncertain', score, ncc, margin,
 *           shiftMm, huDiff, reasons[]}, shiftMm: [dz,dy,dx] from the geometry position to the proposal, stages: {index, geometry, rigid, local} seeds,
 *           registration: {lungDice, yawDeg, shiftMm}}
 */
export function proposeMatch(baseline, follow, opts = {}) {
  const P = { ...MATCH_DEFAULTS, ...opts, conf: { ...MATCH_DEFAULTS.conf, ...(opts.conf || {}) } };
  const B = baseline, F = follow;
  const spB = B.spacing, spF = F.spacing, oB = B.origin || [0, 0, 0], oF = F.origin || [0, 0, 0];
  const clampI = (p) => [0, 1, 2].map((a) => Math.max(0, Math.min(F.dims[a] - 1, Math.round(p[a]))));
  const seed = B.seed;
  const stages = { index: clampI(seed) };
  // 2. geometry: same patient-space point
  const T0 = { t: [0, 0, 0], yaw: 0, c: [0, 0, 0] };
  const sGeo = mapIdx(B, F, T0, seed); stages.geometry = clampI(sGeo);
  // 3. rigid lung registration, starting from the geometry mapping
  let T = T0, reg = { lungDice: null, yawDeg: 0, shiftMm: [0, 0, 0] };
  if (P.useLung && B.lung && F.lung) {
    const r = lungRegister(B, F, [0, 0, 0], P);
    if (r.ok) { T = r; reg = { lungDice: r.score, yawDeg: (r.yaw * 180) / Math.PI, shiftMm: r.t.slice() }; }
  }
  const sRig = mapIdx(B, F, T, seed); stages.rigid = clampI(sRig);
  // 4. local NCC around the tumour (patch centred on the outline centroid, else the seed)
  const cm = B.mask ? maskCentroid(B.mask, B.dims) : { n: 0, c: seed };
  const centre = cm.n ? cm.c : seed;
  const vmm = cm.n * spB[0] * spB[1] * spB[2], rEq = Math.cbrt((3 * vmm) / (4 * Math.PI));
  const radius = Math.min(P.patchMaxMm, Math.max(P.patchMinMm, rEq + P.patchMarginMm));
  const nr = nccRefine(B, F, T, centre, radius, P);
  const shiftB = nr.ok ? nr.shift : [0, 0, 0];
  const sLoc = mapIdx(B, F, T, [seed[0] + shiftB[0], seed[1] + shiftB[1], seed[2] + shiftB[2]]); stages.local = clampI(sLoc);
  const out = stages.local;
  const shiftMm = [(out[0] - stages.geometry[0]) * spF[0], (out[1] - stages.geometry[1]) * spF[1], (out[2] - stages.geometry[2]) * spF[2]];
  const rigidMm = Math.hypot(...[0, 1, 2].map((a) => (out[a] - stages.rigid[a]) * spF[a]));

  // confidence: the NCC peak must be high and distinct, the tissue under the seed must look like the baseline's,
  // and the correction must not be larger than the search was meant to allow.
  const huB = ballMean(B.vol, B.dims, spB, seed.map(Math.round), 3), huF = ballMean(F.vol, F.dims, spF, out, 3);
  const huDiff = Math.abs(huB - huF);
  const margin = nr.ok ? nr.ncc - nr.second : -1;
  const reasons = [];
  if (!nr.ok || nr.ncc < P.conf.nccMin) reasons.push('weak image match');
  if (margin < P.conf.marginMin) reasons.push('ambiguous (second look-alike place)');
  if (!(huDiff <= P.conf.huDiffMax)) reasons.push('tissue under the seed differs');
  if (rigidMm > P.conf.shiftMaxMm) reasons.push('large shift from lung alignment');
  const score = nr.ok ? nr.ncc : 0;
  return {
    seed: out, shiftMm,
    confidence: { level: reasons.length ? 'Uncertain' : 'Confident', score, ncc: nr.ncc, margin, nccAtZero: nr.nccAtZero, rigidMm, huDiff, reasons },
    stages, registration: reg,
  };
}
