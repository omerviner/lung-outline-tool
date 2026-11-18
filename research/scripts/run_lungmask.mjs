// Usage: node run_lungmask.mjs <series dir> <r231.onnx> <out.u8>
import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { buildVolume } from '../../src/core/dicom.js';
import { runLungMask } from '../../src/core/lungmask.js';

const [dir, model, out] = process.argv.slice(2);
const t0 = Date.now();
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.dcm')).map((f) => new Uint8Array(fs.readFileSync(path.join(dir, f))));
const { vol, dims, spacing, meta } = buildVolume(files);
console.log('loaded', dims, spacing.map((v) => +v.toFixed(3)), meta.patientId, `${Date.now() - t0} ms`);
const session = await ort.InferenceSession.create(model);
const t1 = Date.now();
const mask = await runLungMask(ort, session, vol, dims, { batch: 8 });
console.log(`lung mask done in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
fs.writeFileSync(out, mask);
