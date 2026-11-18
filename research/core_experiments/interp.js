// Slice-to-slice shape interpolation for brush edits. Plain JavaScript.
// The user fixes some axial slices; the slices between two fixed ones are filled by interpolating the
// signed distance of the two 2D shapes (negative inside) and thresholding at 0. Slices outside the
// first/last fixed slice are left alone. Works on a full-volume mask or a box.
import { edtSq } from '../../src/core/morph.js';

function signedDist2D(slice, ny, nx, sp2) {
  // slice: Uint8Array ny*nx; returns Float32Array, negative inside, positive outside (mm)
  const inv = new Uint8Array(slice.length);
  let any = false;
  for (let i = 0; i < slice.length; i++) { inv[i] = slice[i] ? 0 : 1; if (slice[i]) any = true; }
  const out = new Float32Array(slice.length);
  const sp = [1, sp2[0], sp2[1]];
  const dOut = edtSq(inv, [1, ny, nx], sp);          // distance of background voxels to the shape
  const dIn = edtSq(slice, [1, ny, nx], sp);         // distance of shape voxels to the background
  for (let i = 0; i < out.length; i++) out[i] = slice[i] ? -Math.sqrt(dIn[i]) : (any ? Math.sqrt(dOut[i]) : 1e3);
  return out;
}

/**
 * @param mask   Uint8Array nz*ny*nx, modified in place
 * @param dims   [nz, ny, nx]
 * @param sp     [dz, dy, dx] mm
 * @param keys   sorted array of slice indices the user has drawn (may include empty slices: an empty key slice means "tumour ends")
 * @returns number of slices filled
 */
export function interpolateSlices(mask, dims, sp, keys) {
  const [, ny, nx] = dims, sl = ny * nx;
  let filled = 0;
  for (let q = 0; q + 1 < keys.length; q++) {
    const a = keys[q], b = keys[q + 1];
    if (b - a < 2) continue;
    const A = mask.subarray(a * sl, (a + 1) * sl), B = mask.subarray(b * sl, (b + 1) * sl);
    const aAny = A.some((x) => x), bAny = B.some((x) => x);
    if (!aAny && !bAny) continue;
    // an empty end point: use a small shrinking disc at the other slice's centroid (a pole), else nothing to blend with
    const dA = signedDist2D(aAny ? A : B, ny, nx, [sp[1], sp[2]]), dB = signedDist2D(bAny ? B : A, ny, nx, [sp[1], sp[2]]);
    for (let z = a + 1; z < b; z++) {
      const w = (z - a) / (b - a);
      const dst = mask.subarray(z * sl, (z + 1) * sl);
      for (let i = 0; i < sl; i++) {
        let da = dA[i], db = dB[i];
        if (!aAny) da = Math.abs(da) + 3 * 1; // empty end: shrink towards nothing
        if (!bAny) db = Math.abs(db) + 3 * 1;
        dst[i] = (1 - w) * da + w * db < 0 ? 1 : 0;
      }
      filled++;
    }
  }
  return filled;
}
