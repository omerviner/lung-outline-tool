// Usage: node summarize_match.mjs <split.json> <csv...>   -> merged per-half summary tables (hit, Dice, distance, volume error per stage)
import fs from 'node:fs';
const [splitFile, ...files] = process.argv.slice(2);
const split = JSON.parse(fs.readFileSync(splitFile, 'utf8'));
const rows = [];
for (const f of files) { const L = fs.readFileSync(f, 'utf8').trim().split('\n'); const h = L[0].split(','); for (const l of L.slice(1)) {
  const c = l.match(/("[^"]*"|[^,]*)(,|$)/g).map((s) => s.replace(/,$/, '').replace(/^"|"$/g, '')); const r = {}; h.forEach((k, i) => (r[k] = c[i])); rows.push(r); } }
const med = (a) => { a = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? (a[a.length >> 1] + a[(a.length - 1) >> 1]) / 2 : NaN; };
const pct = (a, p) => 100 * a.filter(p).length / a.length;
for (const half of ['test', 'tune', 'all']) {
  const R = rows.filter((r) => half === 'all' || split[half].includes(r.patient));
  console.log(`\n## ${half === 'test' ? 'HELD-OUT' : half === 'tune' ? 'tuning half' : 'all'} half: ${R.length} pair-directions, ${new Set(R.map((r) => r.patient)).size} patients (perturb=${R[0]?.perturb})`);
  console.log('stage | hit % | median centre dist mm | median Dice | Dice>=0.7 % | median |vol err| %');
  for (const s of ['index', 'geometry', 'rigid', 'local']) {
    const hit = R.map((r) => +r[`${s}_hit`]), dist = R.map((r) => +r[`${s}_dist_mm`]), d = R.map((r) => +r[`${s}_dice`]), v = R.map((r) => Math.abs(+r[`${s}_vol_err_pct`]));
    console.log(`${s} | ${(100 * hit.reduce((a, b) => a + b, 0) / hit.length).toFixed(0)} | ${med(dist).toFixed(1)} | ${med(d).toFixed(2)} | ${pct(d, (x) => x >= 0.7).toFixed(0)} | ${med(v).toFixed(0)}`);
  }
  const o = R.map((r) => +r.oracle_dice).filter(Number.isFinite), cp = R.map((r) => +r.copy_mask_dice);
  console.log(`oracle (expert-centre click) median Dice ${med(o).toFixed(2)}; plain mask copy median Dice ${med(cp).toFixed(2)}`);
  for (const lvl of ['Confident', 'Uncertain']) { const S = R.filter((r) => r.confidence === lvl); if (S.length) console.log(`${lvl}: n=${S.length}, local hit ${(100 * S.reduce((a, r) => a + +r.local_hit, 0) / S.length).toFixed(0)}%, median Dice ${med(S.map((r) => +r.local_dice)).toFixed(2)}`); }
}
