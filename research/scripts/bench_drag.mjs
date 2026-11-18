// Times the click outline the way the app drives it: one exact click, then a drag (radius previews), then tolerance previews.
// Usage: node bench_drag.mjs <jobs.json> <out.json> [nJobs]   (prints per-request ms; writes mask checksums for comparing versions)
import fs from 'node:fs';
import path from 'node:path';
import { buildVolume } from '../../src/core/dicom.js';
import { downsample } from '../../src/core/blobs.js';
import { outlineFromClick } from '../../src/core/clickoutline.js';

const [jobsFile, outFile, nJobs = '4'] = process.argv.slice(2);
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
const pick = [0, 13, 29, 47].slice(0, +nJobs).map((i) => jobs[i % jobs.length]);
const sum = (m) => { let h = 0, n = 0; for (let i = 0; i < m.length; i++) if (m[i]) { h = (h * 31 + i) >>> 0; n++; } return `${n}:${h}`; };
const out = [];
for (const job of pick) {
  const files = fs.readdirSync(job.ct_dir).filter((f) => f.endsWith('.dcm')).map((f) => new Uint8Array(fs.readFileSync(path.join(job.ct_dir, f))));
  const { vol, dims } = buildVolume(files);
  const { v, dims: gd } = downsample(vol, dims);
  const lung = new Uint8Array(fs.readFileSync(job.lung));
  const seed = job.seeds[0], sp = job.spacing;
  const run = (label, opts) => {
    const t0 = performance.now();
    const r = outlineFromClick(v, gd, sp, lung, seed, opts);
    const ms = performance.now() - t0;
    out.push({ job: job.name, label, ms: +ms.toFixed(1), voxels: r.voxels, sum: sum(r.mask), radiusMm: r.radiusMm });
    return r;
  };
  const first = run('click', {});
  const R = first.radiusMm;
  for (const f of [0.4, 0.6, 0.8, 1, 1.2, 1.5]) run(`drag r=${Math.round(R * f)}`, { radiusMm: Math.max(6, R * f) });
  run('drag exact', { radiusMm: R * 1.2 });
  for (const t of [0.4, 0.45, 0.55, 0.6]) run(`tol ${t}`, { t, radiusMm: R });
  run('tol exact', { t: 0.6 });
  console.log(job.name, out.filter((o) => o.job === job.name).map((o) => `${o.label}:${o.ms}ms`).join('  '));
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
