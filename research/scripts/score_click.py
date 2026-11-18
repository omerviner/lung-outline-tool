"""Score click-to-outline masks against the expert outlines: Dice, volume error, long-axis error, leak.
Usage: python score_click.py <jobs.json> <clicks dir> <out csv>
"""
import json
import sys

import numpy as np
import pandas as pd

jobs_file, clicks_dir, out_csv = sys.argv[1:4]
jobs = json.load(open(jobs_file))

def long_axis(m, sp):
    """Longest extent (mm) along the principal axis, on the slice with the largest area."""
    if not m.any():
        return 0.0
    k = int(np.argmax(m.sum((1, 2))))
    pts = np.argwhere(m[k]) * np.array([sp[1], sp[2]])
    if len(pts) < 3:
        return float(sp[1])
    c = pts - pts.mean(0)
    _, v = np.linalg.eigh(np.cov(c.T))
    p = c @ v
    return float((p.max(0) - p.min(0)).max())

rows = []
for j in jobs:
    shape = tuple(j["shape"]); sp = j["spacing"]
    g = np.fromfile(j["gt"], np.uint8).reshape(shape) > 0
    vox = sp[0] * sp[1] * sp[2]
    la_g = long_axis(g, sp)
    for k, s in enumerate(j["seeds"]):
        m = np.fromfile(f"{clicks_dir}/{j['name']}.{k}.u8", np.uint8).reshape(shape) > 0
        inter = (m & g).sum()
        rows.append(dict(
            name=j["name"], click=("centre" if k == 0 else "random"), gt_ml=g.sum() * vox / 1000,
            outline_ml=m.sum() * vox / 1000, dice=2 * inter / max(m.sum() + g.sum(), 1),
            vol_err_pct=100 * (m.sum() - g.sum()) / g.sum(), long_axis_err_mm=long_axis(m, sp) - la_g,
            empty=bool(m.sum() == 0), leak=bool(m.sum() > 2 * g.sum()),
        ))
pd.DataFrame(rows).to_csv(out_csv, index=False)
print(len(rows), "clicks scored")
