# Research folder: how the algorithms were built and scored

Everything here supports [docs/RESULTS.md](../docs/RESULTS.md). It is not needed to run the app. Research use only; no clinical claims.

## Reading order
1. [reports/outline_v2_report.md](reports/outline_v2_report.md): the click-to-outline method, held-out scores and failures.
2. [reports/matching_report.md](reports/matching_report.md): follow-up matching, scores and robustness.
3. [reports/outline_weak_spots_report.md](reports/outline_weak_spots_report.md): leak fixes that were tried, and slice interpolation.
4. [reports/time_saved_tracker.md](reports/time_saved_tracker.md): the time model, how it is measured, and the trial protocol.
5. [reports/code_design_review.md](reports/code_design_review.md): the code and design review of the app.
6. Background: [reports/lab_requirements.md](reports/lab_requirements.md) and [reports/daniel_sheet_format.md](reports/daniel_sheet_format.md) (what the lab asked for), [reports/client_side_test.md](reports/client_side_test.md) (running the lung model in the browser).

## Contents
- `reports/`: the written reports above.
- `results/`: per-click and per-pair result tables (`click_v1_results.csv`, `click_v2_results.csv`, `click_v3_results.csv`, `click_sweep_results.csv`, `match_results.csv`, finder tables) and `click_v2_failures.png` (overlays of held-out failures).
- `scripts/`: Node and Python scripts that produced them. The algorithms they call are the app's own modules in `../src/core/`.
- `core_experiments/`: `clickoutline_v3.js` (opt-in size-aware variant, not adopted) and `interp.js` (slice interpolation; the app's copy is `../src/core/interp.js`).
- `package.json`, `requirements.txt`: dependencies for the scripts (`npm install` here; a Python venv for the `.py` files).

## Path map
The reports were written in the original project folder, so the paths they mention map to this repository like this:

| In the reports | In this repository |
|---|---|
| `longmarker-tool/core/src/` | `src/core/` (app copy) |
| `longmarker-tool/core/scripts/` | `research/scripts/` |
| `review/*.csv`, `review/*.png` | `research/results/` |
| `notes/*.md` | `research/reports/` |
| `longmarker-tool/work/`, `data/`, `longmarker-tool/client-experiment/` | not included (data, large intermediate files, a one-off browser test) |

## Rerunning the scoring
The scripts expect the original layout: the TCIA data (RIDER Lung CT and RIDER-LungCT-Seg, downloaded with the TCIA Data Retriever, CC BY) under `data/`, the expert masks and downsampled lung masks under `longmarker-tool/work/`, and the pair list `scan_index.csv`. That data is not in this repository, so the scripts are provided to read, and to reproduce the scoring on a machine that has the data; the app itself needs none of it.
