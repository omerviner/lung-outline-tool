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
    const r = outlineFromClick(v, gd, sp, haveLung ? lung : ones, m.seed, { ...m.opts, useLung: haveLung });
    const sl = gd[1] * gd[2];
    let z0 = -1, z1 = -1;
    if (r.voxels) {
      for (let z = 0; z < gd[0]; z++) {
        let any = false;
        for (let i = z * sl, e2 = i + sl; i < e2; i++) if (r.mask[i]) { any = true; break; }
        if (any) { if (z0 < 0) z0 = z; z1 = z; }
      }
    }
    self.postMessage({ type: 'result', id: m.id, mask: r.mask, voxels: r.voxels, zr: z0 < 0 ? null : [z0, z1], ms: Math.round(performance.now() - t0), radiusMm: r.radiusMm, usedLung: haveLung }, [r.mask.buffer]);
  }
};
