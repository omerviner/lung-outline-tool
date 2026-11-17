// Runs the LungMask model (ONNX Runtime Web) and the lung mask post-processing off the main thread.
// Messages in:  { type: 'run', id, vol: ArrayBuffer (Int16 HU volume), dims }
// Messages out: { type: 'progress', id, stage, done, total }, { type: 'done', id, lung: ArrayBuffer, backend, ms }, { type: 'error', id, message }
import * as ort from 'onnxruntime-web/webgpu';
import { runLungMask } from './core/lungmask.js';
import { lungToGrid } from './core/blobs.js';

const base = new URL(import.meta.env.BASE_URL, self.location.href).href;
// One thread: initialising ONNX Runtime's multi-threaded WebAssembly from inside a worker hangs. WebGPU does not need threads.
ort.env.wasm.numThreads = 1;

let session = null, backend = '';

async function loadModel(id, eps) {
  const meta = await (await fetch(`${base}model/model.json`)).json();
  const buf = new Uint8Array(meta.bytes);
  let at = 0;
  for (const name of meta.parts) {
    const part = new Uint8Array(await (await fetch(`${base}model/${name}`)).arrayBuffer());
    buf.set(part, at); at += part.length;
    self.postMessage({ type: 'progress', id, stage: 'model', done: at, total: meta.bytes });
  }
  self.postMessage({ type: 'progress', id, stage: 'check', done: 0, total: 1 });
  const sum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (sum !== meta.sha256) throw new Error('lung model files are corrupted (checksum mismatch)');
  const timeout = (ms, what) => new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} did not start within ${ms / 1000} s`)), ms));
  for (const ep of eps) { // WebGPU when the browser has it, otherwise multi-threaded WebAssembly
    self.postMessage({ type: 'progress', id, stage: 'session', ep, done: 0, total: 1 });
    try {
      session = await Promise.race([ort.InferenceSession.create(buf, { executionProviders: [ep] }), timeout(ep === 'webgpu' ? 25000 : 60000, ep)]);
      backend = ep; return;
    } catch (e) {
      self.postMessage({ type: 'log', id, text: `${ep} failed: ${e && e.message ? e.message : e}` });
      if (ep === eps[eps.length - 1]) throw e;
    }
  }
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type !== 'run') return;
  try {
    const t0 = performance.now();
    if (!session) await loadModel(m.id, m.eps || ['webgpu', 'wasm']);
    const vol = new Int16Array(m.vol);
    const mask = await runLungMask(ort, session, vol, m.dims, {
      batch: 4,
      onProgress: (done, total) => self.postMessage({ type: 'progress', id: m.id, stage: 'infer', done, total }),
    });
    const lung = lungToGrid(mask, m.dims);
    self.postMessage({ type: 'done', id: m.id, lung: lung.buffer, backend, ms: Math.round(performance.now() - t0) }, [lung.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};
