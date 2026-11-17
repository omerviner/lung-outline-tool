// Click-to-outline: grow a 3D outline from one click, bounded by a radius and an intensity tolerance.
// Works on the downsampled grid (see blobs.js). `t` (0..1) is the tolerance: lower = more inclusive.
// Dragging outward in the UI lowers t and raises the radius; dragging inward does the opposite.
import { openBall, dilateBall, label6, gauss3, fillHoles2D } from './morph.js';

function median(a) {
  if (!a.length) return NaN;
  const s = Float32Array.from(a).sort();
  return s[(s.length - 1) >> 1];
}

/**
 * @param v       Float32Array HU volume on the grid
 * @param dims    [nz, ny, nx]
 * @param sp      voxel spacing in mm [dz, dy, dx]
 * @param lung    Uint8Array lung mask on the grid (a mask that includes attached tumours)
 * @param seed    [z, y, x] clicked voxel
 * @returns {mask: Uint8Array(grid), voxels, seedHU, lungHU, threshold}
 */
export function outlineFromClick(v, dims, sp, lung, seed, { t = 0.5, radiusMm = 60, openR = 2, useLung = true } = {}) {
  const [nz, ny, nx] = dims;
  // region of interest around the click
  const lo = [0, 1, 2].map((a) => Math.max(0, seed[a] - Math.ceil(radiusMm / sp[a])));
  const hi = [nz, ny, nx].map((n, a) => Math.min(n, seed[a] + Math.ceil(radiusMm / sp[a]) + 1));
  const rd = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], rn = rd[0] * rd[1] * rd[2];
  const crop = new Float32Array(rn), rl = new Uint8Array(rn), inBall = new Uint8Array(rn);
  const rs = [seed[0] - lo[0], seed[1] - lo[1], seed[2] - lo[2]];
  for (let z = 0; z < rd[0]; z++) for (let y = 0; y < rd[1]; y++) for (let x = 0; x < rd[2]; x++) {
    const i = (z * rd[1] + y) * rd[2] + x, g = ((z + lo[0]) * ny + y + lo[1]) * nx + x + lo[2];
    crop[i] = v[g]; rl[i] = lung[g];
    const dzm = (z - rs[0]) * sp[0], dym = (y - rs[1]) * sp[1], dxm = (x - rs[2]) * sp[2];
    inBall[i] = dzm * dzm + dym * dym + dxm * dxm <= radiusMm * radiusMm ? 1 : 0;
  }
  const sm = gauss3(crop, rd, 1.0);
  // reference intensities: the tissue under the click and the surrounding lung
  const near = [];
  for (let z = 0; z < rd[0]; z++) for (let y = 0; y < rd[1]; y++) for (let x = 0; x < rd[2]; x++) {
    const dzm = (z - rs[0]) * sp[0], dym = (y - rs[1]) * sp[1], dxm = (x - rs[2]) * sp[2];
    if (dzm * dzm + dym * dym + dxm * dxm <= 9) near.push(sm[(z * rd[1] + y) * rd[2] + x]);
  }
  const seedHU = median(near);
  const air = [];
  for (let i = 0; i < rn; i++) if ((rl[i] || !useLung) && sm[i] < -500) air.push(sm[i]);
  const lungHU = air.length > 200 ? median(air) : -850;
  const threshold = lungHU + t * (seedHU - lungHU);
  const result = { mask: new Uint8Array(v.length), voxels: 0, seedHU, lungHU, threshold };
  if (!(seedHU > lungHU + 100)) return result; // clicked on air or very faint tissue

  const cand = new Uint8Array(rn);
  for (let i = 0; i < rn; i++) cand[i] = inBall[i] && (!useLung || rl[i]) && sm[i] > threshold ? 1 : 0;
  // cut thin vessels and thin attachments, keep the part under the click
  const r2 = openR * openR;
  const opened = openBall(cand, rd, r2);
  const { lab } = label6(opened, rd);
  const sIdx = (rs[0] * rd[1] + rs[1]) * rd[2] + rs[2];
  let keepLabel = lab[sIdx];
  if (!keepLabel) { // click landed on a thin part: take the nearest opened component
    let best = 1e9;
    for (let z = 0; z < rd[0]; z++) for (let y = 0; y < rd[1]; y++) for (let x = 0; x < rd[2]; x++) {
      const i = (z * rd[1] + y) * rd[2] + x;
      if (lab[i]) {
        const d = (z - rs[0]) ** 2 + (y - rs[1]) ** 2 + (x - rs[2]) ** 2;
        if (d < best) { best = d; keepLabel = lab[i]; }
      }
    }
    if (best > 100) return result;
  }
  const comp = new Uint8Array(rn);
  for (let i = 0; i < rn; i++) comp[i] = lab[i] === keepLabel ? 1 : 0;
  // grow back toward the original edge, then fill holes slice by slice
  const grown = dilateBall(comp, rd, r2);
  for (let i = 0; i < rn; i++) grown[i] = grown[i] && cand[i] ? 1 : 0;
  const filled = fillHoles2D(grown, rd);
  let count = 0;
  for (let z = 0; z < rd[0]; z++) for (let y = 0; y < rd[1]; y++) for (let x = 0; x < rd[2]; x++) {
    if (filled[(z * rd[1] + y) * rd[2] + x]) { result.mask[((z + lo[0]) * ny + y + lo[1]) * nx + x + lo[2]] = 1; count++; }
  }
  result.voxels = count;
  return result;
}
