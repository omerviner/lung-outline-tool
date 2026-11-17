// Measurements from an outline mask on the downsampled grid.
// Like a ruler: the long axis is the longest distance across the outline on a slice, the short axis is the
// widest extent perpendicular to it. Approximate; not a clinical (RECIST) measurement.
// End points are grid pixel coordinates (y then x) so the lines can be drawn on the image.

/** Convex hull (monotone chain) of points [x, y, ...extra]. */
function convexHull(pts) {
  const p = pts.slice().sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Long and short axis of the outline on slice z, or null when the slice has no outline. */
export function axesOnSlice(mask, dims, sp, z) {
  const [, ny, nx] = dims, o = z * ny * nx, pts = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!mask[o + y * nx + x]) continue;
    if (x === 0 || y === 0 || x === nx - 1 || y === ny - 1 || !mask[o + y * nx + x - 1] || !mask[o + y * nx + x + 1] || !mask[o + (y - 1) * nx + x] || !mask[o + (y + 1) * nx + x]) pts.push([y, x]);
  }
  if (!pts.length) return null;
  const sy = sp[1], sx = sp[2], pix = (sy + sx) / 2;
  // the longest distance and the widest extent are always reached on the convex hull, which is far fewer points
  const hp = convexHull(pts.map((p) => [p[1] * sx, p[0] * sy, p[0], p[1]]));
  let bestD = -1, a = pts[0], b = pts[0];
  for (let i = 0; i < hp.length; i++) for (let j = i + 1; j < hp.length; j++) {
    const dy = hp[i][1] - hp[j][1], dx = hp[i][0] - hp[j][0], d = dy * dy + dx * dx;
    if (d > bestD) { bestD = d; a = [hp[i][2], hp[i][3]]; b = [hp[j][2], hp[j][3]]; }
  }
  const longMm = Math.sqrt(Math.max(bestD, 0)) + pix; // + one pixel: distance between pixel centres undercounts
  let uy = (b[0] - a[0]) * sy, ux = (b[1] - a[1]) * sx;
  const un = Math.hypot(uy, ux) || 1; uy /= un; ux /= un;
  const wy = -ux, wx = uy; // perpendicular direction (mm space)
  const my = ((a[0] + b[0]) / 2) * sy, mx = ((a[1] + b[1]) / 2) * sx; // midpoint of the long axis
  const pm = my * wy + mx * wx;
  let pMin = 0, pMax = 0;
  for (const p of hp) { const pr = p[1] * wy + p[0] * wx - pm; if (pr < pMin) pMin = pr; if (pr > pMax) pMax = pr; }
  const shortMm = pMax - pMin + pix;
  return {
    longMm, shortMm,
    p1: [a[0], a[1]], p2: [b[0], b[1]],
    q1: [(my + wy * pMin) / sy, (mx + wx * pMin) / sx], q2: [(my + wy * pMax) / sy, (mx + wx * pMax) / sx],
  };
}

export function measure(mask, dims, sp, zr) {
  const [nz, ny, nx] = dims, sl = ny * nx, areas = new Int32Array(nz);
  let count = 0;
  const zStart = zr ? zr[0] : 0, zEnd = zr ? zr[1] : nz - 1; // only scan the slices that can hold the outline
  for (let z = zStart; z <= zEnd; z++) {
    let a = 0;
    for (let i = z * sl, e = i + sl; i < e; i++) a += mask[i];
    areas[z] = a; count += a;
  }
  if (!count) return null;
  let best = zStart, first = -1, last = -1;
  for (let z = zStart; z <= zEnd; z++) {
    if (areas[z] > areas[best]) best = z;
    if (areas[z]) { if (first < 0) first = z; last = z; }
  }
  const ax = axesOnSlice(mask, dims, sp, best);
  return {
    volumeMl: (count * sp[0] * sp[1] * sp[2]) / 1000,
    longMm: ax.longMm, shortMm: ax.shortMm, meanMm: (ax.longMm + ax.shortMm) / 2,
    bestSlice: best, firstSlice: first, lastSlice: last, voxels: count,
    axes: ax,
  };
}
