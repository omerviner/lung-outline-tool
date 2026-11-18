# Research folder: how the algorithms were built and scored

Everything here supports `docs/RESULTS.md`. It is not needed to run the app. Research use only; no clinical claims.

- `reports/`: the written reports. `opus_report.md` (click-to-outline method, held-out scores, failures), `opus_match_report.md` (follow-up matching, scores, robustness), `time_saved_tracker.md` (time model, how it is measured, trial log), `client_side_test.md` (running the lung model in the browser), `lab_requirements.md` and `daniel_sheet_format.md` (what the lab asked for).
- `results/`: per-click and per-pair result tables (`click_v1_results.csv`, `click_v2_results.csv`, `click_sweep_results.csv`, `match_results.csv`, finder tables) and `click_v2_failures.png` (overlays of held-out failures).
- `scripts/`: Node and Python scripts that produced them. The algorithms they call are the app's own modules in `../src/core/` (imports are relative to this folder layout).
- `package.json`, `requirements.txt`: dependencies for the scripts (`npm install` here; a Python venv for the `.py` files).

The scripts expect the original project layout: the TCIA data (RIDER Lung CT and RIDER-LungCT-Seg, download with the TCIA Data Retriever, CC BY) under `data/`, the expert masks and downsampled lung masks under `longmarker-tool/work/`, and the pair list `scan_index.csv`. The data is not in this repository, so the scripts are provided for reading and for reproducing the scoring on a machine that has the data; the app itself needs none of it.
- `core_experiments/`: `clickoutline_v3.js` (opt-in size-aware variant) and `interp.js` (slice interpolation), not used by the app yet.
