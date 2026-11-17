// Image-processing building blocks on flat typed arrays (z-major). No dependencies.

const INF = 1e20;

// ---- Euclidean distance transform (Felzenszwalb), squared, anisotropic -------------
function dt1d(f, n, w2, out, v, zz) {
  let k = 0;
  v[0] = 0; zz[0] = -INF; zz[1] = INF;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const p = v[k];
      s = ((f[q] + w2 * q * q) - (f[p] + w2 * p * p)) / (2 * w2 * (q - p));
      if (s <= zz[k] && k > 0) k--; else break;
    }
    if (s <= zz[k]) { v[k] = q; zz[k] = -INF; zz[k + 1] = INF; continue; }
    k++; v[k] = q; zz[k] = s; zz[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (zz[k + 1] < q) k++;
    const d = q - v[k];
    out[q] = w2 * d * d + f[v[k]];
  }
}

/** Squared distance (scaled by `scale`) from each foreground voxel to the nearest 0 voxel. */
export function edtSq(fg, dims, scale = [1, 1, 1]) {
  const [nz, ny, nx] = dims;
  const d = new Float32Array(fg.length);
  for (let i = 0; i < fg.length; i++) d[i] = fg[i] ? INF : 0;
  const m = Math.max(nz, ny, nx);
  const f = new Float64Array(m), o = new Float64Array(m), v = new Int32Array(m), zz = new Float64Array(m + 1);
  // x
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const b = (z * ny + y) * nx;
    for (let x = 0; x < nx; x++) f[x] = d[b + x];
    dt1d(f, nx, scale[2] * scale[2], o, v, zz);
    for (let x = 0; x < nx; x++) d[b + x] = o[x];
  }
  // y
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const b = z * ny * nx + x;
    for (let y = 0; y < ny; y++) f[y] = d[b + y * nx];
    dt1d(f, ny, scale[1] * scale[1], o, v, zz);
    for (let y = 0; y < ny; y++) d[b + y * nx] = o[y];
  }
  // z
  const sl = ny * nx;
  for (let i = 0; i < sl; i++) {
    for (let z = 0; z < nz; z++) f[z] = d[i + z * sl];
    dt1d(f, nz, scale[0] * scale[0], o, v, zz);
    for (let z = 0; z < nz; z++) d[i + z * sl] = o[z];
  }
  return d;
}

function pad3(a, dims, p) {
  const [nz, ny, nx] = dims, D = [nz + 2 * p, ny + 2 * p, nx + 2 * p];
  const out = new a.constructor(D[0] * D[1] * D[2]);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++)
    out.set(a.subarray((z * ny + y) * nx, (z * ny + y) * nx + nx), ((z + p) * D[1] + y + p) * D[2] + p);
  return { a: out, dims: D };
}

function unpad3(a, dims, p) {
  const [nz, ny, nx] = dims, D = [nz - 2 * p, ny - 2 * p, nx - 2 * p];
  const out = new a.constructor(D[0] * D[1] * D[2]);
  for (let z = 0; z < D[0]; z++) for (let y = 0; y < D[1]; y++)
    out.set(a.subarray(((z + p) * ny + y + p) * nx + p, ((z + p) * ny + y + p) * nx + p + D[2]), (z * D[1] + y) * D[2]);
  return out;
}

/** Binary dilation by a ball of squared radius r2 (voxel units). mask: Uint8Array of 0/1. */
export function dilateBall(mask, dims, r2) {
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = edtSq(inv, dims);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = d[i] <= r2 ? 1 : 0;
  return out;
}

/** Binary opening by a ball of squared radius r2 (outside the volume counts as background). */
export function openBall(mask, dims, r2) {
  const P = 3; // pad so the volume border behaves like background
  const { a, dims: D } = pad3(mask, dims, P);
  const d = edtSq(a, D);
  const er = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) er[i] = d[i] > r2 ? 1 : 0;
  const dil = dilateBall(er, D, r2);
  return unpad3(dil, D, P);
}

// ---- connected components (6-connectivity) --------------------------------------
export function label6(mask, dims) {
  const [nz, ny, nx] = dims, sl = ny * nx;
  const lab = new Int32Array(mask.length);
  const stack = new Int32Array(mask.length);
  let n = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || lab[s]) continue;
    n++; let sp = 0; stack[sp++] = s; lab[s] = n;
    while (sp) {
      const i = stack[--sp], z = (i / sl) | 0, r = i - z * sl, y = (r / nx) | 0, x = r - y * nx;
      if (x > 0 && mask[i - 1] && !lab[i - 1]) { lab[i - 1] = n; stack[sp++] = i - 1; }
      if (x < nx - 1 && mask[i + 1] && !lab[i + 1]) { lab[i + 1] = n; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - nx] && !lab[i - nx]) { lab[i - nx] = n; stack[sp++] = i - nx; }
      if (y < ny - 1 && mask[i + nx] && !lab[i + nx]) { lab[i + nx] = n; stack[sp++] = i + nx; }
      if (z > 0 && mask[i - sl] && !lab[i - sl]) { lab[i - sl] = n; stack[sp++] = i - sl; }
      if (z < nz - 1 && mask[i + sl] && !lab[i + sl]) { lab[i + sl] = n; stack[sp++] = i + sl; }
    }
  }
  return { lab, n };
}

// ---- separable filters -----------------------------------------------------------
function reflect(i, n) {
  while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1;
  return i;
}

/** Gaussian blur, sigma in voxels, kernel truncated at 4 sigma, 'reflect' borders (like scipy). */
export function gauss3(a, dims, sigma) {
  const r = Math.ceil(4 * sigma), k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const [nz, ny, nx] = dims, strides = [ny * nx, nx, 1];
  let src = Float32Array.from(a), dst = new Float32Array(a.length); // copy: never overwrite the caller's array
  for (let ax = 0; ax < 3; ax++) {
    const n = dims[ax], st = strides[ax];
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (z * ny + y) * nx + x, p = ax === 0 ? z : ax === 1 ? y : x;
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += k[j + r] * src[i + (reflect(p + j, n) - p) * st];
      dst[i] = acc;
    }
    [src, dst] = [dst, src];
  }
  return src;
}

/** Local maxima: value equals the max in a (2r+1)^3 window, > thresh, not within r of the border. */
export function peakLocalMax(a, dims, r, thresh) {
  const [nz, ny, nx] = dims, strides = [ny * nx, nx, 1];
  let src = Float32Array.from(a), dst = new Float32Array(a.length); // copy: never overwrite the caller's array
  for (let ax = 0; ax < 3; ax++) {
    const n = dims[ax], st = strides[ax];
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (z * ny + y) * nx + x, p = ax === 0 ? z : ax === 1 ? y : x;
      let m = 0;
      for (let j = -r; j <= r; j++) { const q = p + j; if (q >= 0 && q < n) { const v = src[i + j * st]; if (v > m) m = v; } }
      dst[i] = m;
    }
    [src, dst] = [dst, src];
  }
  const peaks = [];
  for (let z = r; z < nz - r; z++) for (let y = r; y < ny - r; y++) for (let x = r; x < nx - r; x++) {
    const i = (z * ny + y) * nx + x;
    if (a[i] > thresh && a[i] === src[i]) peaks.push(i);
  }
  return peaks;
}

// ---- marker-controlled watershed (6-connectivity), lowest value floods first ----------
export function watershed(value, markers, mask, dims) {
  const [nz, ny, nx] = dims, sl = ny * nx;
  const out = new Int32Array(value.length);
  let cap = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) cap++;
  cap += markers.length + 8;
  const hv = new Float32Array(cap), ha = new Int32Array(cap), hi = new Int32Array(cap);
  let size = 0, age = 0;
  const less = (a, b) => hv[a] < hv[b] || (hv[a] === hv[b] && ha[a] < ha[b]);
  const swap = (a, b) => {
    let t = hv[a]; hv[a] = hv[b]; hv[b] = t;
    t = ha[a]; ha[a] = ha[b]; ha[b] = t;
    t = hi[a]; hi[a] = hi[b]; hi[b] = t;
  };
  const push = (i) => {
    let c = size++; hv[c] = value[i]; ha[c] = age++; hi[c] = i;
    while (c > 0) { const p = (c - 1) >> 1; if (less(c, p)) { swap(c, p); c = p; } else break; }
  };
  const pop = () => {
    const top = hi[0]; size--;
    if (size > 0) {
      hv[0] = hv[size]; ha[0] = ha[size]; hi[0] = hi[size];
      let c = 0;
      for (;;) {
        const l = 2 * c + 1, r = l + 1; let m = c;
        if (l < size && less(l, m)) m = l;
        if (r < size && less(r, m)) m = r;
        if (m === c) break; swap(c, m); c = m;
      }
    }
    return top;
  };
  markers.forEach((i, k) => { out[i] = k + 1; push(i); });
  while (size) {
    const i = pop(), z = (i / sl) | 0, r = i - z * sl, y = (r / nx) | 0, x = r - y * nx, l = out[i];
    const tryN = (j) => { if (mask[j] && !out[j]) { out[j] = l; push(j); } };
    if (x > 0) tryN(i - 1); if (x < nx - 1) tryN(i + 1);
    if (y > 0) tryN(i - nx); if (y < ny - 1) tryN(i + nx);
    if (z > 0) tryN(i - sl); if (z < nz - 1) tryN(i + sl);
  }
  return out;
}

// ---- per-slice hole filling (background not connected to the slice border becomes foreground) ----
export function fillHoles2D(mask, dims) {
  const [nz, ny, nx] = dims, sl = ny * nx, out = new Uint8Array(mask);
  const bg = new Uint8Array(sl), st = new Int32Array(sl);
  for (let z = 0; z < nz; z++) {
    bg.fill(0); let sp = 0;
    const o = z * sl;
    const seed = (i) => { if (!mask[o + i] && !bg[i]) { bg[i] = 1; st[sp++] = i; } };
    for (let x = 0; x < nx; x++) { seed(x); seed((ny - 1) * nx + x); }
    for (let y = 0; y < ny; y++) { seed(y * nx); seed(y * nx + nx - 1); }
    while (sp) {
      const i = st[--sp], y = (i / nx) | 0, x = i - y * nx;
      if (x > 0) seed(i - 1); if (x < nx - 1) seed(i + 1);
      if (y > 0) seed(i - nx); if (y < ny - 1) seed(i + nx);
    }
    for (let i = 0; i < sl; i++) if (!mask[o + i] && !bg[i]) out[o + i] = 1;
  }
  return out;
}
