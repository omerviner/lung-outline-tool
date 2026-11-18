// Usage: node tune_conf.mjs <split.json> <runDir>
// Robustness table per perturbation (held-out and tuning half), and the confidence rule: thresholds on (ncc, margin, huDiff, rigid_mm)
// are chosen on the TUNING half only (maximise coverage of "Confident" subject to >= 95% of Confident proposals being hits and
// Dice >= 0.5 for >= 90%), then applied unchanged to the held-out half.
import fs from 'node:fs';
const [splitFile, ...dirs] = process.argv.slice(2);
const split = JSON.parse(fs.readFileSync(splitFile, 'utf8'));
const rows = [];
for (const dir of dirs) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.csv'))) {
  const L = fs.readFileSync(`${dir}/${f}`, 'utf8').trim().split('\n'); const h = L[0].split(',');
  for (const l of L.slice(1)) { const c = l.match(/("[^"]*"|[^,]*)(,|$)/g).map((s) => s.replace(/,$/, '').replace(/^"|"$/g, '')); const r = {}; h.forEach((k, i) => (r[k] = c[i])); r.variant = dir.includes('nolung') ? 'NCC only (no lung registration)' : 'full pipeline'; rows.push(r); }
}
const half = (r) => (split.test.includes(r.patient) ? 'test' : 'tune');
const order = ['none', 's5', 's10', 's20', 's30', 's60', 's80', 'z15', 'z30', 'xy15', 'xy30', 'r3', 'r6', 'r10', 'r15', 'sc5', 'sc5m', 'sc10', 'combo'];
const rate = (R, k) => (R.length ? (100 * R.reduce((a, r) => a + +r[k], 0) / R.length).toFixed(0) : '-');
const med = (a) => { a = a.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? ((a[a.length >> 1] + a[(a.length - 1) >> 1]) / 2).toFixed(1) : '-'; };
for (const variant of [...new Set(rows.map((r) => r.variant))]) for (const hf of ['test', 'tune']) {
  console.log(`\n### [${variant}] ${hf === 'test' ? 'HELD-OUT' : 'tuning'} half: hit % (seed inside the expert outline) per stage, local = proposal; median local centre error mm; median local Dice`);
  console.log('perturbation | n | index | geometry | rigid | local | local dist mm | local Dice');
  for (const p of order) {
    const R = rows.filter((r) => r.perturb === p && half(r) === hf && r.variant === variant); if (!R.length) continue;
    console.log(`${p} | ${R.length} | ${rate(R, 'index_hit')} | ${rate(R, 'geometry_hit')} | ${rate(R, 'rigid_hit')} | ${rate(R, 'local_hit')} | ${med(R.map((r) => +r.local_dist_mm))} | ${med(R.map((r) => +r.local_dice))}`);
  }
}
// confidence tuning
const feat = (r) => ({ ncc: +r.ncc, margin: +r.margin, hu: +r.huDiff, rig: +r.rigid_mm });
const good = (r) => +r.local_hit === 1 && +r.local_dice >= 0.3; // seed in the expert outline and outline not collapsed
const tune = rows.filter((r) => half(r) === 'tune'), test = rows.filter((r) => half(r) === 'test');
const ev = (R, th) => { const C = R.filter((r) => { const f = feat(r); return f.ncc >= th.nccMin && f.margin >= th.marginMin && f.hu <= th.huDiffMax && f.rig <= th.shiftMaxMm; }); return { n: C.length, cov: C.length / R.length, hit: C.length ? C.filter((r) => +r.local_hit === 1).length / C.length : NaN, good: C.length ? C.filter(good).length / C.length : NaN }; };
const TARGET_HIT = +(process.env.TARGET_HIT || 0.95); let best = null;
for (const nccMin of [0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8]) for (const marginMin of [0, 0.05, 0.1, 0.15, 0.2, 0.3]) for (const huDiffMax of [100, 150, 250, 400, 1e9]) for (const shiftMaxMm of [10, 15, 22, 30, 1e9]) {
  const th = { nccMin, marginMin, huDiffMax, shiftMaxMm }, e = ev(tune, th);
  if (e.n >= 5 && e.hit >= TARGET_HIT && e.good >= TARGET_HIT - 0.05 && (!best || e.cov > best.e.cov)) best = { th, e };
}
console.log('\n### confidence rule chosen on the tuning half (all conditions pooled):', JSON.stringify(best?.th));
for (const [nm, R] of [['tuning', tune], ['HELD-OUT', test]]) {
  if (!best) { console.log('no rule meets the target'); continue; }
  const e = ev(R, best.th);
  const all = { hit: R.filter((r) => +r.local_hit === 1).length / R.length };
  console.log(`${nm}: n=${R.length}; proposals hitting without any rule ${(100 * all.hit).toFixed(0)}%; Confident covers ${(100 * e.cov).toFixed(0)}% (n=${e.n}), of which hit ${(100 * e.hit).toFixed(0)}%, usable (hit & Dice>=0.3) ${(100 * e.good).toFixed(0)}%`);
  const U = R.filter((r) => { const f = feat(r), th = best.th; return !(f.ncc >= th.nccMin && f.margin >= th.marginMin && f.hu <= th.huDiffMax && f.rig <= th.shiftMaxMm); });
  console.log(`   Uncertain: n=${U.length}, hit ${(100 * U.filter((r) => +r.local_hit === 1).length / Math.max(U.length, 1)).toFixed(0)}%`);
}
// per-condition held-out under the chosen rule
if (best) { console.log('\nheld-out (both variants pooled), Confident share and hit rate of Confident per perturbation:'); for (const p of order) { const R = test.filter((r) => r.perturb === p); if (!R.length) continue; const e = ev(R, best.th); console.log(`${p}: confident ${e.n}/${R.length}, hit among confident ${isNaN(e.hit) ? '-' : (100 * e.hit).toFixed(0) + '%'}; hit overall ${rate(R, 'local_hit')}%`); } }
// how well does each feature separate hits from misses? (AUC on the tuning half, pooled; 0.5 = useless)
const auc = (R, key, sign = 1) => { const P = R.filter((r) => +r.local_hit === 1).map((r) => sign * feat(r)[key]), N = R.filter((r) => +r.local_hit !== 1).map((r) => sign * feat(r)[key]); let w = 0; for (const p of P) for (const n of N) w += p > n ? 1 : p === n ? 0.5 : 0; return P.length && N.length ? (w / (P.length * N.length)).toFixed(2) : '-'; };
for (const [nm, R] of [['tuning', tune], ['HELD-OUT', test]]) console.log(`AUC hit-vs-miss (${nm}, n=${R.length}, misses=${R.filter((r) => +r.local_hit !== 1).length}): ncc ${auc(R, 'ncc')}, margin ${auc(R, 'margin')}, huDiff ${auc(R, 'hu', -1)}, rigid_mm ${auc(R, 'rig', -1)}`);
