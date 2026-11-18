"""Independent check of score_match.mjs: recompute Dice, volume error and centre distance for the proposal stage
('local') and the oracle from the saved outline masks and the expert masks, without any JS code.
Usage: python -I check_match.py <jobs.json> <maskdir> <csv ...>   (csv = score_match output with perturb=none)"""
import csv, json, sys, numpy as np
jobs = {j['name']: j for j in json.load(open(sys.argv[1]))}
maskdir = sys.argv[2]; worst = 0; n = 0
for f in sys.argv[3:]:
    for r in csv.DictReader(open(f)):
        a, b = r['direction'].split('>'); p = r['patient']
        gt = np.fromfile(jobs[f'{p}_{b}']['gt'], np.uint8).astype(bool)
        for tag, col in (('local', 'local_dice'), ('oracle', 'oracle_dice')):
            m = np.fromfile(f'{maskdir}/{p}_{a}_to_{b}.none.{tag}.u8', np.uint8).astype(bool)
            d = 2 * (m & gt).sum() / max(m.sum() + gt.sum(), 1)
            worst = max(worst, abs(d - float(r[col]))); n += 1
        m = np.fromfile(f'{maskdir}/{p}_{a}_to_{b}.none.local.u8', np.uint8).astype(bool)
        ve = 100 * (m.sum() - gt.sum()) / gt.sum()
        worst = max(worst, abs(ve - float(r['local_vol_err_pct'])) / 100)
print(f'checked {n} Dice values (+ volume errors); max abs difference to the JS numbers: {worst:.5f}')
