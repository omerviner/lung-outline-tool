"""Score the JS candidate finder against the expert outlines, with the same hit rule as finder/evaluate.py.

Usage: python score_js.py <scan_index.csv> <js output dir> <out csv>
"""
import csv
import glob
import json
import os
import sys

import numpy as np
import pydicom

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "finder"))
import evaluate as E  # noqa: E402  (gt_mask, dice)


def headers(ct_dir):
    ds = [pydicom.dcmread(f, stop_before_pixels=True) for f in glob.glob(f"{ct_dir}/*.dcm")]
    ds.sort(key=lambda d: float(d.ImagePositionPatient[2]))
    zs = np.array([float(d.ImagePositionPatient[2]) for d in ds])
    dy, dx = (float(v) for v in ds[0].PixelSpacing)
    dz = float(np.median(np.diff(zs)))
    return zs, (float(ds[0].ImagePositionPatient[0]), float(ds[0].ImagePositionPatient[1])), (dz, dy, dx)


index_csv, js_dir, out_csv = sys.argv[1:4]
rows = []
for r in csv.DictReader(open(index_csv)):
    name = f"{r['patient']}_{r['scan']}"
    info = json.load(open(f"{js_dir}/{name}.json"))
    shape = tuple(info["dims"])
    labels = np.fromfile(f"{js_dir}/{name}.labels.u8", np.uint8).reshape(shape)
    zs, origin, spacing = headers(r["ct_series_folder"])
    g = E.gt_mask(r["rtstruct_file"], zs, origin, spacing, shape)
    gvox = g.sum()
    best = dict(rank=None, hit_cand_vol=None, dice=0.0)
    for c in info["candidates"]:
        m = labels == c["rank"]
        ov = (m & g).sum() / max(gvox, 1)
        if ov >= 0.3 and m.sum() <= 5 * gvox and best["rank"] is None:
            best.update(rank=c["rank"], hit_cand_vol=c["volume_mm3"])
        best["dice"] = max(best["dice"], float(E.dice(m, g)))
    vox = info["spacing"][0] * info["spacing"][1] * info["spacing"][2]
    rows.append(dict(
        patient=r["patient"], scan=r["scan"], gt_vol_mm3=float(gvox * vox), n_candidates=len(info["candidates"]),
        hit=best["rank"] is not None, rank=best["rank"], best_dice=best["dice"], hit_cand_vol_mm3=best["hit_cand_vol"],
    ))
with open(out_csv, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys())
    w.writeheader()
    w.writerows(rows)
print(f"{sum(x['hit'] for x in rows)}/{len(rows)} scans: expert tumour found among JS candidates")
