// Usage: node eval_interp.mjs <jobs.json> <out csv>  (run from project root)
// For each expert outline, keep every k-th slice (k = 2..6, plus the first and last slice), interpolate the rest,
// and score against the full expert outline. Also reports the share of slices the user would not have to draw.
import fs from 'node:fs';
import { interpolateSlices } from '../core_experiments/interp.js';
const [jobsFile, outCsv] = process.argv.slice(2);
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
const rows = ['name,k,slices,drawn,saved_pct,dice_interp,dice_nearest'];
for (const job of jobs) {
  const [nz, ny, nx] = job.shape, sl = ny * nx;
  const gt = new Uint8Array(fs.readFileSync(job.gt));
  let z0 = nz, z1 = -1;
  for (let z = 0; z < nz; z++) { for (let i = z * sl; i < (z + 1) * sl; i++) if (gt[i]) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); break; } }
  if (z1 < 0) continue;
  for (const k of [2, 3, 4, 5, 6]) {
    const keys = []; for (let z = z0; z <= z1; z += k) keys.push(z); if (keys[keys.length - 1] !== z1) keys.push(z1);
    const m = new Uint8Array(gt.length), nn = new Uint8Array(gt.length);
    for (const z of keys) m.set(gt.subarray(z * sl, (z + 1) * sl), z * sl);
    interpolateSlices(m, job.shape, job.spacing, keys);
    // baseline: copy the nearest key slice (what you get with no interpolation)
    for (let z = z0; z <= z1; z++) { let bz = keys[0]; for (const q of keys) if (Math.abs(q - z) < Math.abs(bz - z)) bz = q; nn.set(gt.subarray(bz * sl, (bz + 1) * sl), z * sl); }
    const dice = (a) => { let i2 = 0, sa = 0, sg = 0; for (let i = 0; i < gt.length; i++) { if (a[i] && gt[i]) i2++; sa += a[i]; sg += gt[i]; } return 2 * i2 / (sa + sg); };
    const n = z1 - z0 + 1;
    rows.push([job.name, k, n, keys.length, (100 * (1 - keys.length / n)).toFixed(1), dice(m).toFixed(4), dice(nn).toFixed(4)].join(','));
  }
  console.error(job.name);
}
fs.writeFileSync(outCsv, rows.join('\n') + '\n');
