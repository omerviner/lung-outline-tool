// Runs the click-to-outline computation off the main thread so the page never freezes.
// Until the lung mask arrives it runs without a lung limit; after that it uses the lung hull (higher quality).
import { outlineFromClick } from './core/clickoutline.js';

let v = null, gd = null, sp = null, ones = null, lung = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    v = new Float32Array(m.v); gd = m.gd; sp = m.sp; lung = null;
    ones = new Uint8Array(v.length).fill(1);
    self.postMessage({ type: 'ready' });
  } else if (m.type === 'lung') {
    lung = new Uint8Array(m.lung);
  } else if (m.type === 'outline') {
    const t0 = performance.now(), haveLung = !!lung;
    // boxOnly: the result is a small box around the outline, not a copy of the whole volume
    const r = outlineFromClick(v, gd, sp, haveLung ? lung : ones, m.seed, { ...m.opts, useLung: haveLung, boxOnly: true });
    const box = r.box ? { origin: r.box.origin, dims: r.box.dims, data: r.box.data } : null;
    self.postMessage({ type: 'result', id: m.id, box, voxels: r.voxels, zr: r.zr, ms: Math.round(performance.now() - t0), radiusMm: r.radiusMm, usedLung: haveLung }, box ? [box.data.buffer] : []);
  }
};
