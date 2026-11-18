"""Held-out summary for click-to-outline (split by patient). Run with: python -I report_v2.py
Reads score_*.csv (from score_click.py), the split, and the v1 sweep; prints markdown tables."""
import io
import json
import re
import numpy as np
import pandas as pd

O = 'longmarker-tool/work/out/'
sp = json.load(open(O + 'split.json'))
half = lambda n: 'tune' if n.split('_')[0] in sp['tune'] else 'test'
size = lambda s: pd.cut(s, [0, 2, 10, 40, 1e9], labels=['<2 mL', '2-10 mL', '10-40 mL', '>40 mL'])

def summ(x):
    return pd.Series({
        'clicks': len(x), 'median Dice': x.dice.median(), '>=0.7': (x.dice >= .7).mean(), '>=0.5': (x.dice >= .5).mean(),
        'median abs vol err %': x.vol_err_pct.abs().median(), 'median abs long-axis err mm': x.long_axis_err_mm.abs().median(),
        'empty': x['empty'].mean(), 'leak (>2x)': x['leak'].mean(), 'under (<0.5x)': (x.outline_ml < 0.5 * x.gt_ml).mean()})

def fmt(t):
    t = t.copy()
    for c in t.columns:
        if c == 'clicks': t[c] = [f'{q:.0f}' for q in t[c]]
        elif c in ('>=0.7', '>=0.5', 'empty', 'leak (>2x)', 'under (<0.5x)'): t[c] = [f'{100 * q:.0f}%' if q == q else '-' for q in t[c]]
        else: t[c] = [f'{q:.2f}' if q == q else '-' for q in t[c]]
    return t.to_markdown()

S = {v: pd.read_csv(O + f'score_{v}.csv') for v in ['v1', 'v2']}
for v, d in S.items():
    d['half'] = d.name.map(half); d['size'] = size(d.gt_ml)
for h in ['test', 'tune']:
    print(f'\n### {h} half: overall\n')
    rows = {f'{v}': summ(d[d.half == h]) for v, d in S.items()}
    sw = pd.read_csv(io.StringIO(re.sub(r'(true|false)(RIDER-)', r'\1\n\2', open('review/click_sweep_results.csv').read())));  # 3 rows were merged in the file
    print('v1 sweep rows', len(sw), 'per click', sw.groupby('name').size().min() / 5)
    sw = sw[sw.name.map(half) == h]
    sw['k'] = sw.groupby(['name', 'useLung', 't', 'radiusMm']).cumcount()
    o = sw.groupby(['name', 'k']).dice.max()
    rows['v1 oracle (best of 24, uses expert)'] = pd.Series({'clicks': len(o), 'median Dice': o.median(), '>=0.7': (o >= .7).mean(), '>=0.5': (o >= .5).mean()})
    print(fmt(pd.DataFrame(rows).T))
    for v, d in S.items():
        x = d[d.half == h]
        t = pd.concat([x.groupby('size', observed=True).apply(summ, include_groups=False)])
        print(f'\n{v}, {h} half, by expert volume\n'); print(fmt(t))
