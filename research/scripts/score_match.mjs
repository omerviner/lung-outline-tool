// Score follow-up matching on the same-day TEST/RETEST pairs, both directions.
// Usage (project root = the folder that holds data/): node longmarker-tool/core/scripts/score_match.mjs \
//        <jobs.json> <cacheDir> <out.csv> <part> <parts> [--perturb <name>] [--maskdir <dir>] [--conf '{"nccMin":0.5}']
// cacheDir comes from cache_scans.mjs. Baseline = the expert outline of one scan of the pair with the simulated click
// jobs.json seeds[0] (the tumour centre); the target is the expert outline of the other scan.
// Per stage (index, geometry, rigid, local = the proposal) it records: seed inside the expert outline (hit), centre
// distance in mm, and, for an outline grown from that seed with outlineFromClick: Dice and volume error.
// --perturb moves the follow-up scan before matching (shift/rotate/scale; see PERTURB) and moves its expert outline and lung mask with it.
import fs from 'node:fs';
import path from 'node:path';
import { outlineFromClick } from '../../src/core/clickoutline.js';
import { proposeMatch } from '../../src/core/match.js';

const args = process.argv.slice(2);
const [jobsFile, cacheDir, outCsv, part, parts] = args;
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const perturbName = opt('--perturb') || 'none', maskDir = opt('--maskdir');
const confOpt = { ...(opt('--conf') ? { conf: JSON.parse(opt('--conf')) } : {}), ...(args.includes('--nolung') ? { useLung: false } : {}) };
const onlyDir = opt('--direction'); // optional: 'TEST>RETEST' or 'RETEST>TEST'
const withOutline = opt('--outline') !== 'local'; // 'local' = outline only for the proposal stage

// shift vectors are in mm [z,y,x]; rot in degrees about the table axis; scale is isotropic about the volume centre
const dirv = (m) => { const v = [0.5, 0.5, 0.7], n = Math.hypot(...v); return v.map((a) => (a / n) * m); };
export const PERTURB = {
  none: {},
  s5: { shift: dirv(5) }, s10: { shift: dirv(10) }, s20: { shift: dirv(20) }, s30: { shift: dirv(30) },
  z15: { shift: [15, 0, 0] }, z30: { shift: [30, 0, 0] }, xy15: { shift: [0, 10, 11] }, xy30: { shift: [0, 21, 21] },
  s60: { shift: dirv(60) }, s80: { shift: dirv(80) }, r10: { rot: 10 }, r15: { rot: 15 }, sc10: { scale: 1.1 },
  r3: { rot: 3 }, r6: { rot: 6 }, sc5: { scale: 1.05 }, sc5m: { scale: 0.95 },
  combo: { shift: dirv(15), rot: 3, scale: 1.05 },
};

const readU8 = (f) => new Uint8Array(fs.readFileSync(f));
function load(name, jobs) {
  const job = jobs.find((j) => j.name === name), meta = JSON.parse(fs.readFileSync(path.join(cacheDir, name + '.json')));
  const i16 = new Int16Array(fs.readFileSync(path.join(cacheDir, name + '.i16')).buffer.slice(0));
  const ds = meta.ds;
  const sp = job.spacing; // grid spacing (mm)
  // patient-space position of grid voxel (0,0,0) centre: the grid cell averages full-res pixels 0..ds-1
  const origin = [meta.zs[0], meta.origin[1] + ((ds - 1) / 2) * meta.spacing[1], meta.origin[0] + ((ds - 1) / 2) * meta.spacing[2]];
  return { name, job, vol: Float32Array.from(i16), dims: job.shape, spacing: sp, origin, lung: readU8(job.lung), gt: readU8(job.gt), seed: job.seeds[0], seeds: job.seeds };
}

// resample a scan under a perturbation: new(p) = old(q), forward p = c + s R(th)(q - c) + shift (mm, grid axes)
function perturb(S, cfg) {
  if (!cfg.shift && !cfg.rot && !cfg.scale) return S;
  const [nz, ny, nx] = S.dims, sp = S.spacing, sh = cfg.shift || [0, 0, 0], th = ((cfg.rot || 0) * Math.PI) / 180, sc = cfg.scale || 1;
  const c = [(nz - 1) / 2 * sp[0], (ny - 1) / 2 * sp[1], (nx - 1) / 2 * sp[2]], cs = Math.cos(th), sn = Math.sin(th);
  const N = S.vol.length, vol = new Float32Array(N), lung = new Uint8Array(N), gt = new Uint8Array(N);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const pz = z * sp[0] - c[0] - sh[0], py = y * sp[1] - c[1] - sh[1], px = x * sp[2] - c[2] - sh[2];
    const qz = (pz / sc + c[0]) / sp[0], qy = ((cs * py + sn * px) / sc + c[1]) / sp[1], qx = ((-sn * py + cs * px) / sc + c[2]) / sp[2];
    const i = (z * ny + y) * nx + x;
    if (qz < 0 || qy < 0 || qx < 0 || qz > nz - 1 || qy > ny - 1 || qx > nx - 1) { vol[i] = -1000; continue; }
    const z0 = Math.floor(qz), y0 = Math.floor(qy), x0 = Math.floor(qx), z1 = Math.min(z0 + 1, nz - 1), y1 = Math.min(y0 + 1, ny - 1), x1 = Math.min(x0 + 1, nx - 1);
    const fz = qz - z0, fy = qy - y0, fx = qx - x0, v = S.vol, a = (zz, yy, xx) => v[(zz * ny + yy) * nx + xx];
    const c00 = a(z0, y0, x0) * (1 - fx) + a(z0, y0, x1) * fx, c01 = a(z0, y1, x0) * (1 - fx) + a(z0, y1, x1) * fx;
    const c10 = a(z1, y0, x0) * (1 - fx) + a(z1, y0, x1) * fx, c11 = a(z1, y1, x0) * (1 - fx) + a(z1, y1, x1) * fx;
    vol[i] = (c00 * (1 - fy) + c01 * fy) * (1 - fz) + (c10 * (1 - fy) + c11 * fy) * fz;
    const j = (Math.round(qz) * ny + Math.round(qy)) * nx + Math.round(qx);
    lung[i] = S.lung[j]; gt[i] = S.gt[j];
  }
  return { ...S, vol, lung, gt };
}

function stats(mask, dims, sp) {
  let n = 0, sz = 0, sy = 0, sx = 0; const [nz, ny, nx] = dims;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (mask[(z * ny + y) * nx + x]) { n++; sz += z; sy += y; sx += x; }
  return { n, c: n ? [sz / n, sy / n, sx / n] : null };
}
const dice = (a, b, na, nb) => { let i = 0; for (let k = 0; k < a.length; k++) if (a[k] && b[k]) i++; return na + nb ? (2 * i) / (na + nb) : 0; };

const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
const names = new Set(jobs.map((j) => j.name));
const patients = [...new Set(jobs.map((j) => j.name.split('_')[0]))].filter((p) => names.has(p + '_TEST') && names.has(p + '_RETEST')).sort();
const tasks = [];
for (const p of patients) for (const dir of [['TEST', 'RETEST'], ['RETEST', 'TEST']]) tasks.push([p, ...dir]);
const mine = tasks.filter((_, i) => i % +parts === +part).filter((t) => !onlyDir || onlyDir === `${t[1]}>${t[2]}`);
const STAGES = ['index', 'geometry', 'rigid', 'local'];
const header = ['patient', 'direction', 'perturb', 'volume_ml_target', 'target_slices', 'start_slice_diff'];
for (const s of STAGES) header.push(`${s}_hit`, `${s}_dist_mm`, `${s}_dice`, `${s}_vol_err_pct`);
header.push('proposed_seed_zyx', 'oracle_dice', 'copy_mask_dice', 'confidence', 'conf_reasons', 'ncc', 'margin', 'huDiff', 'rigid_mm', 'lung_dice_reg', 'yaw_deg', 'match_ms');
const rows = [header.join(',')];
if (maskDir) fs.mkdirSync(maskDir, { recursive: true });
const f = (x, d = 3) => (x === undefined || x === null || Number.isNaN(x) ? '' : (+x).toFixed(d));

for (const [p, a, b] of mine) {
  const A = load(`${p}_${a}`, jobs); let Bs = load(`${p}_${b}`, jobs);
  Bs = perturb(Bs, PERTURB[perturbName]);
  const sp = Bs.spacing, gtB = stats(Bs.gt, Bs.dims, sp), gtA = stats(A.gt, A.dims, A.spacing);
  const t0 = Date.now();
  const m = proposeMatch({ vol: A.vol, dims: A.dims, spacing: A.spacing, mask: A.gt, seed: A.seed, lung: A.lung, origin: A.origin },
    { vol: Bs.vol, dims: Bs.dims, spacing: sp, lung: Bs.lung, origin: Bs.origin }, confOpt);
  const ms = Date.now() - t0;
  const cache = new Map();
  const outline = (seed, tag) => {
    const key = seed.join(',');
    if (!cache.has(key)) cache.set(key, outlineFromClick(Bs.vol, Bs.dims, sp, Bs.lung, seed, {}));
    const r = cache.get(key);
    if (maskDir && tag) fs.writeFileSync(path.join(maskDir, `${p}_${a}_to_${b}.${perturbName}.${tag}.u8`), r.mask);
    return r;
  };
  const row = { patient: p, direction: `${a}>${b}`, perturb: perturbName, volume_ml_target: (gtB.n * sp[0] * sp[1] * sp[2]) / 1000, target_slices: Bs.dims[0], start_slice_diff: Math.round(Math.abs(A.origin[0] - Bs.origin[0]) / A.spacing[0]) };
  const out = [p, `${a}>${b}`, perturbName, f(row.volume_ml_target, 2), Bs.dims[0], row.start_slice_diff];
  for (const s of STAGES) {
    const sd = m.stages[s];
    const hit = Bs.gt[(sd[0] * Bs.dims[1] + sd[1]) * Bs.dims[2] + sd[2]] ? 1 : 0;
    const dist = Math.hypot((sd[0] - gtB.c[0]) * sp[0], (sd[1] - gtB.c[1]) * sp[1], (sd[2] - gtB.c[2]) * sp[2]);
    let d = '', ve = '';
    if (withOutline || s === 'local') {
      const r = outline(sd, s === 'local' ? 'local' : null);
      d = r.voxels ? dice(r.mask, Bs.gt, r.voxels, gtB.n) : 0;
      ve = (100 * (r.voxels - gtB.n)) / gtB.n;
    }
    out.push(hit, f(dist, 1), f(d, 4), f(ve, 1));
  }
  // oracle: outline grown from the expert centre (nearest expert voxel to the centroid): the outlining ceiling for this scan
  let orc = '';
  if (perturbName === 'none') {
    let bestI = -1, bestD = 1e18;
    for (let z = 0; z < Bs.dims[0]; z++) for (let y = 0; y < Bs.dims[1]; y++) for (let x = 0; x < Bs.dims[2]; x++) if (Bs.gt[(z * Bs.dims[1] + y) * Bs.dims[2] + x]) {
      const d = ((z - gtB.c[0]) * sp[0]) ** 2 + ((y - gtB.c[1]) * sp[1]) ** 2 + ((x - gtB.c[2]) * sp[2]) ** 2; if (d < bestD) { bestD = d; bestI = [z, y, x]; }
    }
    const r = outline(bestI, 'oracle'); orc = r.voxels ? dice(r.mask, Bs.gt, r.voxels, gtB.n) : 0;
  }
  // copying the expert outline of the baseline into the same slice/pixel positions of the follow-up (the "no matching" baseline)
  const copy = A.dims[0] === Bs.dims[0] || true ? (() => { const n = Math.min(A.gt.length, Bs.gt.length); let i = 0; for (let k = 0; k < n; k++) if (A.gt[k] && Bs.gt[k]) i++; return (2 * i) / (gtA.n + gtB.n); })() : '';
  const c = m.confidence;
  out.push(m.stages.local.join('/'), f(orc, 4), f(copy, 4), c.level, `"${c.reasons.join('; ')}"`, f(c.ncc), f(c.margin), f(c.huDiff, 0), f(c.rigidMm, 1), f(m.registration.lungDice), f(m.registration.yawDeg, 1), ms);
  rows.push(out.join(','));
  console.error(`${p} ${a}>${b} ${perturbName} local hit=${out[header.indexOf('local_hit')]} ${c.level} ${ms}ms`);
}
fs.writeFileSync(outCsv, rows.join('\n') + '\n');
