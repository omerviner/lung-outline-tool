// Usage: node run_blobs.mjs <series dir> <lung mask .u8 (full-res or downsampled grid)> <out prefix>
import fs from 'node:fs';
import path from 'node:path';
import { buildVolume } from '../../src/core/dicom.js';
import { findCandidates, lungToGrid, DS } from '../../src/core/blobs.js';

const [dir, lungFile, prefix] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.dcm')).map((f) => new Uint8Array(fs.readFileSync(path.join(dir, f))));
const { vol, dims, spacing } = buildVolume(files);
const raw = new Uint8Array(fs.readFileSync(lungFile));
const [nz, H, W] = dims, gridSize = nz * Math.floor(H / DS) * Math.floor(W / DS);
const lung = raw.length === gridSize ? raw : lungToGrid(raw, dims);
const t0 = Date.now();
const res = findCandidates(vol, dims, spacing, lung, { debug: !!process.env.DEBUG_DUMP });
console.log(`${res.candidates.length} candidates in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
fs.writeFileSync(`${prefix}.labels.u8`, res.labels);
fs.writeFileSync(`${prefix}.json`, JSON.stringify({ dims: res.dims, spacing: res.spacing, candidates: res.candidates }));
if (res.debug) {
  fs.writeFileSync(`${prefix}.opened.u8`, res.debug.opened);
  fs.writeFileSync(`${prefix}.dists.f32`, Buffer.from(res.debug.distS.buffer));
  fs.writeFileSync(`${prefix}.peaks.json`, JSON.stringify(res.debug.peaks));
}
