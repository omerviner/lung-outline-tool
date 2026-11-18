// Usage: node sweep_click.mjs <jobs.json> <out csv> <part> <parts>
// Tries a grid of click settings (tolerance t, radius, lung limit) and records Dice and volume ratio.
import fs from 'node:fs';
import path from 'node:path';
import { buildVolume } from '../../src/core/dicom.js';
import { downsample } from '../../src/core/blobs.js';
import { outlineFromClick } from '../../src/core/clickoutline.js';

const [jobsFile, outCsv, part, parts] = process.argv.slice(2);
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8')).filter((_, i) => i % +parts === +part);
const configs = [];
for (const useLung of [true, false]) for (const t of [0.3, 0.45, 0.6]) for (const radiusMm of [20, 35, 50, 70]) configs.push({ useLung, t, radiusMm });
const rows = ['name,click,useLung,t,radiusMm,dice,vol_ratio,empty'];
for (const job of jobs) {
  const files = fs.readdirSync(job.ct_dir).filter((f) => f.endsWith('.dcm')).map((f) => new Uint8Array(fs.readFileSync(path.join(job.ct_dir, f))));
  const { vol, dims } = buildVolume(files);
  const { v, dims: gd } = downsample(vol, dims);
  const lung = new Uint8Array(fs.readFileSync(job.lung)), gt = new Uint8Array(fs.readFileSync(job.gt));
  let gv = 0; for (let i = 0; i < gt.length; i++) gv += gt[i];
  job.seeds.forEach((s, k) => {
    for (const c of configs) {
      const r = outlineFromClick(v, gd, job.spacing, lung, s, { ...c, openR: 2 });
      let inter = 0; if (r.voxels) for (let i = 0; i < gt.length; i++) if (gt[i] && r.mask[i]) inter++;
      rows.push([job.name, k === 0 ? 'centre' : 'random', c.useLung, c.t, c.radiusMm, (2 * inter / Math.max(r.voxels + gv, 1)).toFixed(4), (r.voxels / gv).toFixed(3), r.voxels === 0].join(','));
    }
  });
  console.log(job.name);
}
fs.writeFileSync(outCsv, rows.join('\n'));
