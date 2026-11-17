// Measurements from an outline mask on the downsampled grid.
// Long and short axis are the extents along the outline's principal axes on the slice with the largest area
// (approximate; not a clinical RECIST measurement).

export function measure(mask, dims, sp) {
  const [nz, ny, nx] = dims, sl = ny * nx, areas = new Int32Array(nz);
  let count = 0;
  for (let z = 0; z < nz; z++) {
    let a = 0;
    for (let i = z * sl, e = i + sl; i < e; i++) a += mask[i];
    areas[z] = a; count += a;
  }
  if (!count) return null;
  let best = 0, first = -1, last = -1;
  for (let z = 0; z < nz; z++) {
    if (areas[z] > areas[best]) best = z;
    if (areas[z]) { if (first < 0) first = z; last = z; }
  }
  // principal-axis extents on the best slice
  const pts = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (mask[best * sl + y * nx + x]) pts.push([y * sp[1], x * sp[2]]);
  const n = pts.length;
  let my = 0, mx = 0; for (const p of pts) { my += p[0]; mx += p[1]; } my /= n; mx /= n;
  let syy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { const dy = p[0] - my, dx = p[1] - mx; syy += dy * dy; sxx += dx * dx; sxy += dy * dx; }
  const theta = 0.5 * Math.atan2(2 * sxy, syy - sxx), c = Math.cos(theta), s = Math.sin(theta);
  let aMin = 1e9, aMax = -1e9, bMin = 1e9, bMax = -1e9;
  for (const p of pts) {
    const u = (p[0] - my) * c + (p[1] - mx) * s, v = -(p[0] - my) * s + (p[1] - mx) * c;
    if (u < aMin) aMin = u; if (u > aMax) aMax = u; if (v < bMin) bMin = v; if (v > bMax) bMax = v;
  }
  const e1 = aMax - aMin + sp[1], e2 = bMax - bMin + sp[2]; // add one pixel: extents of pixel centres
  const longAxis = Math.max(e1, e2), shortAxis = Math.min(e1, e2);
  return {
    volumeMl: (count * sp[0] * sp[1] * sp[2]) / 1000,
    longMm: longAxis, shortMm: shortAxis, meanMm: (longAxis + shortAxis) / 2,
    bestSlice: best, firstSlice: first, lastSlice: last, voxels: count,
  };
}
