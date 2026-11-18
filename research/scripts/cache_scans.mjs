// Usage (run from the project root, longmarker-tool/..): node longmarker-tool/core/scripts/cache_scans.mjs <jobs.json> <outdir> <part> <parts>
// Reads each scan from DICOM, downsamples in-plane (2x) and writes <name>.i16 plus <name>.json with the geometry
// (origin, slice positions, spacing, orientation) that the matcher needs. Output goes outside data/.
import fs from 'node:fs';
import path from 'node:path';
import { buildVolume } from '../../src/core/dicom.js';
import { downsample, DS } from '../../src/core/blobs.js';
const [jobsFile, outDir, part, parts] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8')).filter((_, i) => i % +parts === +part);
for (const job of jobs) {
  const files = fs.readdirSync(job.ct_dir).filter((f) => f.endsWith('.dcm')).map((f) => new Uint8Array(fs.readFileSync(path.join(job.ct_dir, f))));
  const { vol, dims, spacing, origin, zs, meta } = buildVolume(files);
  const { v, dims: gd } = downsample(vol, dims);
  fs.writeFileSync(path.join(outDir, job.name + '.i16'), Buffer.from(Int16Array.from(v).buffer));
  fs.writeFileSync(path.join(outDir, job.name + '.json'), JSON.stringify({ dims: gd, fullDims: dims, spacing, origin, zs, ds: DS, iop: meta.iop, studyDate: meta.studyDate, series: meta.seriesNumber }));
  console.error(job.name);
}
