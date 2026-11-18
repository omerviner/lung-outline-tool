"""Run run_blobs.mjs on every scan in scan_index.csv (two at a time)."""
import csv
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

index_csv, lung_dir, out_dir = sys.argv[1:4]
os.makedirs(out_dir, exist_ok=True)
here = os.path.dirname(os.path.abspath(__file__))

def run(r):
    name = f"{r['patient']}_{r['scan']}"
    out = subprocess.run(
        ["node", f"{here}/run_blobs.mjs", r["ct_series_folder"], f"{lung_dir}/{name}.u8", f"{out_dir}/{name}"],
        capture_output=True, text=True,
    )
    print(name, out.stdout.strip(), out.stderr.strip()[:200], flush=True)

with ThreadPoolExecutor(2) as ex:
    list(ex.map(run, list(csv.DictReader(open(index_csv)))))
print("ALL DONE", flush=True)
