"""Convert the Python LungMask .nii.gz masks to the downsampled grid used by the blob stage (.u8)."""
import csv
import os
import sys
import numpy as np
import SimpleITK as sitk

index_csv, mask_dir, out_dir = sys.argv[1:4]
os.makedirs(out_dir, exist_ok=True)
for r in csv.DictReader(open(index_csv)):
    name = f"{r['patient']}_{r['scan']}"
    m = sitk.GetArrayFromImage(sitk.ReadImage(f"{mask_dir}/{name}_lungmask.nii.gz")) > 0
    ds = m[:, : m.shape[1] // 2 * 2 : 2, : m.shape[2] // 2 * 2 : 2]
    ds.astype(np.uint8).tofile(f"{out_dir}/{name}.u8")
print("done")
