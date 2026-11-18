// Usage: node click_all.mjs <jobs.json> <out dir> <part> <parts> [t] [radiusMm] [openR]
// Omitted (or '-') settings use the automatic v2 defaults.
import fs from 'node:fs';
import path from 'node:path';
import { buildVolume } from '../../src/core/dicom.js';
import { downsample } from '../../src/core/blobs.js';
import { outlineFromClick } from '../../src/core/clickoutline.js';

const [jobsFile, out, part, parts, t, radius, openR] = process.argv.slice(2);
const opts = {};
if (t && t !== '-') opts.t = +t;
if (radius && radius !== '-') opts.radiusMm = +radius;
if (openR && openR !== '-') opts.openR = +openR;
fs.mkdirSync(out, { recursive: true });
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8')).filter((_, i) => i % +parts === +part);
for (const job of jobs) {
  const files = fs.readdirSync(job.ct_dir).filter((f) => f.endsWith('.dcm')).map((f) => new Uint8Array(fs.readFileSync(path.join(job.ct_dir, f))));
  const { vol, dims } = buildVolume(files);
  const { v, dims: gd } = downsample(vol, dims);
  const lung = new Uint8Array(fs.readFileSync(job.lung));
  const info = [];
  job.seeds.forEach((s, k) => {
    const t0 = Date.now();
    const r = outlineFromClick(v, gd, job.spacing, lung, s, opts);
    fs.writeFileSync(path.join(out, `${job.name}.${k}.u8`), r.mask);
    info.push({ seed: s, voxels: r.voxels, seedHU: r.seedHU, lungHU: r.lungHU, threshold: r.threshold, radiusMm: r.radiusMm, openMm: r.openMm, thickMm: r.thickMm, ms: Date.now() - t0 });
  });
  fs.writeFileSync(path.join(out, `${job.name}.json`), JSON.stringify(info));
  console.log(job.name, info.map((i) => `${i.voxels}v/${i.ms}ms`).join(' '));
}
