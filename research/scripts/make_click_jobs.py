"""Make ground-truth masks (downsampled grid) and simulated clicks for every scan.

Clicks per scan: 1 at the voxel of the expert tumour closest to its centre, plus 4 random voxels
inside the tumour (eroded by 2 voxels where possible), to mimic a human clicking anywhere on it.
Usage: python make_click_jobs.py <scan_index.csv> <lung_ds dir> <out dir>
"""
import csv
import json
import os
import sys

import numpy as np
from scipy import ndimage as ndi

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "finder"))
import evaluate as E  # noqa: E402
import glob  # noqa: E402
import pydicom  # noqa: E402


def headers(ct_dir):
    ds = [pydicom.dcmread(f, stop_before_pixels=True) for f in glob.glob(f"{ct_dir}/*.dcm")]
    ds.sort(key=lambda d: float(d.ImagePositionPatient[2]))
    zs = np.array([float(d.ImagePositionPatient[2]) for d in ds])
    dy, dx = (float(v) for v in ds[0].PixelSpacing)
    return zs, (float(ds[0].ImagePositionPatient[0]), float(ds[0].ImagePositionPatient[1])), (float(np.median(np.diff(zs))), dy, dx)

index_csv, lung_dir, out_dir = sys.argv[1:4]
os.makedirs(out_dir, exist_ok=True)
rng = np.random.default_rng(0)
jobs = []
for r in csv.DictReader(open(index_csv)):
    name = f"{r['patient']}_{r['scan']}"
    zs, origin, spacing = headers(r["ct_series_folder"])
    lung = np.fromfile(f"{lung_dir}/{name}.u8", np.uint8)
    shape = (len(zs), 256, 256)
    g = E.gt_mask(r["rtstruct_file"], zs, origin, spacing, shape)
    g.astype(np.uint8).tofile(f"{out_dir}/{name}.gt.u8")
    idx = np.argwhere(g)
    centre = idx.mean(0)
    seeds = [idx[np.argmin(((idx - centre) ** 2).sum(1))].tolist()]
    core = ndi.binary_erosion(g, iterations=2)
    pool = np.argwhere(core) if core.any() else idx
    for k in rng.choice(len(pool), size=4, replace=len(pool) < 4):
        seeds.append(pool[k].tolist())
    jobs.append(dict(name=name, ct_dir=r["ct_series_folder"], lung=f"{lung_dir}/{name}.u8", gt=f"{out_dir}/{name}.gt.u8",
                     seeds=seeds, shape=list(shape), spacing=[spacing[0], spacing[1] * 2, spacing[2] * 2]))
json.dump(jobs, open(f"{out_dir}/jobs.json", "w"))
print(len(jobs), "jobs written")
