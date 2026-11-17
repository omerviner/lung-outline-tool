// Split the lung model into chunks under the 25 MiB per-file limit of free static hosts.
// Usage: node scripts/split-model.mjs <r231.onnx>   (writes public/model/part-N.bin and model.json)
import fs from 'node:fs';
import crypto from 'node:crypto';

const input = process.argv[2];
if (!input) { console.error('usage: node scripts/split-model.mjs <model.onnx>'); process.exit(1); }
const CHUNK = 20 * 1024 * 1024;
const data = fs.readFileSync(input);
fs.mkdirSync('public/model', { recursive: true });
const parts = [];
for (let i = 0, n = 0; i < data.length; i += CHUNK, n++) {
  const name = `part-${n}.bin`;
  fs.writeFileSync(`public/model/${name}`, data.subarray(i, i + CHUNK));
  parts.push(name);
}
const sha256 = crypto.createHash('sha256').update(data).digest('hex');
fs.writeFileSync('public/model/model.json', JSON.stringify({ name: 'LungMask R231 (ONNX)', bytes: data.length, sha256, parts }, null, 2));
console.log(`${parts.length} parts, ${data.length} bytes, sha256 ${sha256.slice(0, 12)}...`);
