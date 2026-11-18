# Click-to-outline v2: method and held-out results

17 Nov 2026. Research use only, no clinical claims. Data: RIDER Lung CT (TCIA, CC BY). Lung mask: LungMask R231 (Apache-2.0).

## Summary

- The new default outline (no expert data at inference) reaches **median Dice 0.74 on held-out patients**, with 63% of clicks at 0.7 or above, 85% at 0.5 or above, and 0% empty. On the same held-out clicks, the best v1 fixed setting (chosen on the tuning half) gets 0.59, 43%, 55% and 3% empty.
- It **does not quite reach the ceiling** on held-out patients. The ceiling (v1, best of 24 settings per click, chosen with the expert outline) is median 0.78, 68% at 0.7 and 93% at 0.5. v2 gets 0.74, 63% and 85%. On the tuning half, v2 matches or beats the ceiling (0.77 vs 0.75), but that half was used to choose its settings.
- **Volume error halves.** Median absolute volume error falls from 58% to 22%. 61% of held-out clicks are within 33% of the expert volume (the largest same-day repeat-scan difference), up from 40%.
- **Leaks halve** (33% to 16% of held-out clicks over 2x the expert volume). Under-growth falls from 20% to 5%.
- **Regression: small nodules (<2 mL).** v2 is worse than v1 here: median Dice 0.73 vs 0.79, 33% leak vs 27%, long-axis error 5.1 mm vs 1.6 mm. This is the main open problem; see Failures.
- A per-click selector that picks among candidate outlines using image features did **not** help (see "Tried and dropped").

## Evaluation protocol

- 59 scans, 31 patients, 5 fixed simulated clicks per scan (`work/click_jobs/jobs.json`, not regenerated): 295 clicks.
- **Split by patient.** Patients were sorted by mean expert volume, then each consecutive pair was split by a seeded coin (seed 44). That gives a **tuning half of 16 patients (30 scans, 150 clicks)** and a **held-out half of 15 patients (29 scans, 145 clicks)**, with similar size mixes. The split is saved in `longmarker-tool/work/out/split.json`. Every setting was chosen on the tuning half.
- **Honesty caveat.** My sweep printouts showed held-out columns next to the tuning columns during development, so I saw held-out numbers before freezing the settings. I always chose by the tuning columns, and I stopped tuning once the final held-out table existed (the small-nodule regression is reported, not fixed). Still, some optimism is possible.
- The final numbers come from a clean end-to-end run that starts from DICOM (`eval_v2.mjs` with `-`). Masks were then scored by the existing Python scorer `score_click.py`, an independent check: its Dice agrees with the JS Dice to within 5e-5 on all 295 clicks.
- Metrics follow the handoff: Dice, volume error, long-axis error, empty, leak (>2x expert volume), plus under-growth (<0.5x).

## Method (`longmarker-tool/core/src/clickoutline.js`)

The interface is unchanged: `outlineFromClick(v, dims, sp, lung, seed, opts)`, plain JavaScript with no new dependencies. Defaults are in the exported `DEFAULTS`.

1. **Lung hull instead of the lung mask.** The growth limit is the convex hull of the learned lung mask, computed on each axial slice and separately for left and right (split at the midline of the lung voxels). It is cached per mask array.
   - The raw mask holds only 20-50% of several expert tumours, because it cuts out tumours touching the pleura or mediastinum. The hull holds at least 94% of every expert tumour except one patient (RIDER-3115188676, 60-69%). This was checked against an independent scikit-image hull in Python.
   - The hull still excludes the chest wall. This one change removes the "lung limit off" trade-off: empty clicks drop to 0-1% without the leaks of `useLung:false`.
2. **Intensities.**
   - Tumour HU is the 75th percentile of the smoothed image within 4 mm of the click (or the click voxel itself, if higher). This makes it robust to clicks near the edge.
   - Lung HU is the median of lung-mask voxels below -500.
3. **Two levels.**
   - A dense core: voxels above lung + 0.9 x (tumour - lung).
   - The outline edge: voxels above lung + t x (tumour - lung), with t = 0.5.
4. **Size from the image.** The method climbs the distance map of the core from the click to its peak. That gives the tumour centre and its thickness (inscribed radius).
   - Search ball: 2.5 x thickness + 8 mm, centred on the tumour rather than the click.
   - Opening radius: 0.7 x thickness, clamped to 1.5-6 mm and never above 0.8 x thickness, so tiny nodules do not vanish.
5. **Cut, keep, grow back.** Open the core to cut vessels and thin attachments, then keep the component at the centre. Grow back up to 10 mm into the edge level, keep what is connected, and fill holes per slice.
6. **Drag controls.**
   - `t` controls the edge (lower = more inclusive).
   - `radiusMm` sets the search ball around the tumour centre. The result returns the automatic `radiusMm`, so a drag can start from it. Passing the same value back gives an identical outline (checked).
   - On 20 sampled clicks, volume falls steadily as `t` rises and grows as the radius rises.
   - `useLung:false` and `limit:'mask'` (the v1 limit) remain available.
7. **Speed.** About 0.35-0.65 s per click in Node, single process (v1: about 0.2 s), and up to about 1.3 s for the largest tumours. Most of the cost is the 80 mm read region.

Settings chosen on the tuning half (median Dice on tuning clicks):

- The edge shell beats a single threshold: 0.65 with one threshold vs 0.72-0.78 with core plus shell.
- The core level is on a plateau from 0.85 to 0.95 (0.75-0.78). I picked 0.9, the middle of it, because 1.0 collapses to 0.50.
- `t` (0.4-0.6) and the seed percentile (0.5-0.9) barely matter (±0.01).

## Held-out results (15 patients, 145 clicks)

| | median Dice | ≥0.7 | ≥0.5 | empty | leak >2x | under <0.5x | median abs vol err | median abs long-axis err |
|---|---|---|---|---|---|---|---|---|
| v1, best fixed setting chosen on tuning half (t 0.6, r 50 mm, lung mask) | 0.59 | 43% | 55% | 3% | 33% | 20% | 58% | 6.0 mm |
| **v2 default** | **0.74** | **63%** | **85%** | **0%** | **16%** | **5%** | **22%** | **4.2 mm** |
| v2 without lung limit (`useLung:false`; what the app gets today, see below) | 0.68 | 49% | 68% | 0% | 31% | – | – | – |
| v2 with the v1 lung-mask limit (`limit:'mask'`) | 0.67 | 45% | 69% | 7% | 11% | – | – | – |
| Ceiling: v1 best of 24 settings per click, chosen with the expert outline | 0.78 | 68% | 93% | – | – | – | – | – |

The two ablation rows were run on the cached HU volumes (`/tmp`), not the final DICOM run, so they may differ in the last digit.

Per click on the held-out half, v2 beats v1 by more than 0.05 Dice on 60% of clicks and loses by more than 0.05 on 19%. Median Dice is 0.78 for the centre click and 0.74 for the random clicks inside the tumour.

### By expert tumour volume (held-out)

| size | clicks | v1 median Dice | **v2 median Dice** | v2 ≥0.7 | v2 ≥0.5 | v2 leak | v2 under | v2 abs vol err | v2 abs long-axis err |
|---|---|---|---|---|---|---|---|---|---|
| <2 mL | 30 | 0.79 | **0.73** | 67% | 67% | 33% | 0% | 29% | 5.1 mm |
| 2-10 mL | 50 | 0.49 | **0.74** | 64% | 90% | 8% | 0% | 19% | 2.7 mm |
| 10-40 mL | 45 | 0.58 | **0.67** | 44% | 84% | 20% | 16% | 32% | 4.3 mm |
| >40 mL | 20 | 0.47 | **0.88** | 100% | 100% | 0% | 0% | 17% | 6.5 mm |

The tuning half, for reference: v2 0.77 / 58% / 71% (≥0.7 / ≥0.5) / 1% empty / 17% leak, vs v1 0.61 / 39% / 60% / 16% empty. All 59 scans together (partly tuned, so optimistic): 0.76 median, 61% ≥0.7, 78% ≥0.5, 0.3% empty, 16% leak. Full tables (with the v1 rows by size) are in `longmarker-tool/work/out/report_tables.md`. To regenerate them, run `python -I longmarker-tool/core/scripts/report_v2.py` from the project root.

## Failures (held-out, plainly)

Overlays of four held-out failures are in `review/click_v2_failures.png` (green: expert, red: v2, yellow: lung hull, cyan: lung mask).

- **Tiny nodules beside vessels (RIDER-1801720707, 0.25 mL): Dice 0.35, 4x too large.** The 10 mm grow-back follows vessels touching the nodule. v1 was also poor here (0.25). This is the main cause of the <2 mL regression, together with the long-axis error. A grow-back that scales with size improved small nodules on the tuning half (0.49 to 0.60) but lowered the overall median (0.78 to 0.64), so I did not adopt it. The tuning half has only 3 patients under 2 mL, too few to tune a size-specific rule safely.
- **Hazy or spiculated margins drawn by the expert (RIDER-2357766186, 22 mL): Dice 0.54-0.61, 0.4-0.5x the volume.** v2 outlines the solid part, while the expert included the ground-glass rim. v1's lower threshold happened to fit this case better (0.82-0.86). Dragging `t` down is the fix. The same pattern appears on the tuning half (RIDER-1344011628).
- **Tumours against the posterior chest wall or spine (RIDER-2016615262, 29 mL): Dice 0.54, about 2-2.5x the volume.** The leak runs along the paravertebral soft tissue, which lies inside the lung hull. It is still much better than v1 (0.30-0.32).
- **Part-solid or spiculated nodules (RIDER-1760553574, 4 mL): Dice 0.51-0.56, 1.5-1.8x the volume.** The spicules are included as tumour.
- **Mediastinal attachment (tuning half: RIDER-2073083717, RIDER-9763310455).** The per-side hull includes the region next to the mediastinum near the hilum, so tumours abutting the superior vena cava or heart can leak 5-10x.
- **Expert outlines that do not match the CT (RIDER-2669524182, tuning half).** Treated as noise, as the handoff suggests; the one remaining tuning-half empty click is here.

## What the drag and brush still have to fix

- **About 1 click in 6 leaks (>2x volume).** Mostly small nodules with vessels, and tumours against the mediastinum, chest wall or spine. An inward drag (smaller radius) helps when the leak is far from the tumour; leaks along the pleura need the brush.
- **About 1 in 20 is under half the volume.** These are hazy, ground-glass or spiculated edges. An outward drag (lower `t`) usually recovers them.
- **Small nodules under 2 mL.** One in three needs a fix: the user should expect to shrink the outline.
- 15% of held-out clicks are still below Dice 0.5, and 37% below 0.7. The time-saving model's "2.5 min to click, check and edit" assumes most outlines need only a small drag. That holds for about 6 in 10 clicks.

## Tried and dropped

- **Choosing settings per click from image features** (edge strength, volume stability across `t`, the share of the outline border that cuts through tissue rather than meeting air, compactness, how much the search ball or hull limits the outline). I tried two approaches:
  - Hand-made rules (edge strength, volume plateau) on top of v1: worse than a fixed setting on the held-out half.
  - A ridge model over 18 v2 candidates, evaluated leave-one-patient-out within the tuning half: 0.758 vs 0.752 for the best single setting, at 18x the runtime.
  - Single "if leaky, retry tighter" fallbacks: up to +0.02 on the tuning half, but only after searching about 450 rule variants on 16 patients, so likely noise. Not adopted.
  - The descriptor code is kept behind `opts.stats` (it does not change the mask) in case a larger dataset makes it worthwhile.
- **Larger search balls** (3-5x thickness) let more leaks through. Core levels of 0.97 or more lose the core on heterogeneous tumours.

## Notes for merging

- **The app does not get the full gain yet.** `app/src/outline.worker.js` passes an all-ones lung mask, so v2 runs without a lung limit there (held-out 0.68 instead of 0.74). The app needs the LungMask output, and `app/src/core/clickoutline.js` must be re-synced (`app/scripts/sync-core.sh`). The worker also echoes `m.opts.radiusMm` back to the page; with v2 it should return `r.radiusMm`, the automatic radius, so the drag starts from it. I did not change the app.
- **Pre-existing data issue.** `review/click_sweep_results.csv` has 3 places where two rows were merged on one line: parts were concatenated without a trailing newline, so 7,077 lines instead of 7,080 rows. The file is left as is; `report_v2.py` repairs it on read. The 0.76 / 63% / 88% ceiling in the handoff therefore dropped 3 rows; the recomputed all-59 ceiling barely moves.
- **Time tracker.** I did not edit `notes/time_saved_tracker.md`. If you update it, the measured line becomes: held-out median Dice 0.74, 63% ≥0.7, 85% ≥0.5, 0% empty.

## Files

- `longmarker-tool/core/src/clickoutline.js`: v2 (same signature; exports `DEFAULTS` and `lungHull`).
- `longmarker-tool/work/out/clickoutline_v1.js`: the v1 algorithm, kept for comparison runs.
- `longmarker-tool/core/scripts/eval_v2.mjs`: runs a list of option sets on all clicks, from DICOM or cached volumes, writes Dice, settings and optional masks.
- `longmarker-tool/core/scripts/report_v2.py`: held-out tables.
- `longmarker-tool/core/scripts/click_all.mjs`: now uses the automatic defaults unless settings are passed (`-` skips one).
- `review/click_v2_results.csv`: per-click results for v2, with columns `split` (tune/test), Dice, volume and long-axis error, empty, leak, the automatic settings, runtime and `dice_v1_tuned`.
- `review/click_v2_failures.png`: failure overlays.
- `longmarker-tool/work/out/`: `split.json`, final masks (`click_v2_masks`, `click_v1_masks`), scores, run CSVs.
