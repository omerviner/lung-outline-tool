// Usage: node eval_v2.mjs <jobs.json> <vol dir|-> <configs.json> <out csv> <part> <parts> [module] [maskdir]
// Runs click outlines for a list of option sets and records Dice, volume and settings per click.
// vol dir: folder of <name>.i16 downsampled HU volumes (from DICOM if '-'). Run from the project root.
import fs from 'node:fs';
import path from 'node:path';
import { buildVolume } from '../../src/core/dicom.js';
import { downsample } from '../../src/core/blobs.js';

const [jobsFile, volDir, cfgFile, outCsv, part, parts, mod = '../src/clickoutline.js', maskDir] = process.argv.slice(2);
const { outlineFromClick } = await import(path.isAbsolute(mod) ? mod : new URL(mod, import.meta.url).href);
const configs = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8')).filter((_, i) => i % +parts === +part);
const SK = ['volMl', 'cutFrac', 'regionCut', 'ballFrac', 'contrast', 'grad', 'outLung', 'compact', 'sizeVsThick'];
const rows = ['name,click,k,cfg,dice,gtv,vox,ms,seedHU,lungHU,threshold,radiusMm,openMm,thickMm,' + SK.join(',')];
if (maskDir) fs.mkdirSync(maskDir, { recursive: true });
for (const job of jobs) {
  let v, gd = job.shape;
  if (volDir !== '-') v = Float32Array.from(new Int16Array(fs.readFileSync(path.join(volDir, job.name + '.i16')).buffer.slice(0)));
  else {
    const files = fs.readdirSync(job.ct_dir).filter((f) => f.endsWith('.dcm')).map((f) => new Uint8Array(fs.readFileSync(path.join(job.ct_dir, f))));
    const { vol, dims } = buildVolume(files); ({ v, dims: gd } = downsample(vol, dims));
  }
  const lung = new Uint8Array(fs.readFileSync(job.lung)), gt = new Uint8Array(fs.readFileSync(job.gt));
  let gv = 0; for (let i = 0; i < gt.length; i++) gv += gt[i];
  job.seeds.forEach((s, k) => {
    configs.forEach((c, ci) => {
      const t0 = Date.now();
      const r = outlineFromClick(v, gd, job.spacing, lung, s, c);
      const ms = Date.now() - t0;
      let inter = 0; if (r.voxels) for (let i = 0; i < gt.length; i++) if (gt[i] && r.mask[i]) inter++;
      if (maskDir) fs.writeFileSync(path.join(maskDir, `${job.name}.${k}.u8`), r.mask);
      const f = (x, d = 1) => (x === undefined || Number.isNaN(x) ? '' : (+x).toFixed(d));
      rows.push([job.name, k === 0 ? 'centre' : 'random', k, ci, (2 * inter / Math.max(r.voxels + gv, 1)).toFixed(4), gv, r.voxels, ms,
        f(r.seedHU), f(r.lungHU), f(r.threshold), f(r.radiusMm), f(r.openMm, 2), f(r.thickMm, 2), ...SK.map((q) => f(r.stats?.[q], 4))].join(','));
    });
  });
  console.error(job.name);
}
fs.writeFileSync(outCsv, rows.join('\n') + '\n');
