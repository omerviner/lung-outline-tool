// Follow-up matching off the main thread: where is the baseline tumour on this scan? (see core/match.js)
import { proposeMatch } from './core/match.js';

self.onmessage = (e) => {
  const { baseline, follow } = e.data, t0 = performance.now();
  try {
    const r = proposeMatch(baseline, follow);
    self.postMessage({ type: 'done', seed: r.seed, confidence: r.confidence, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
