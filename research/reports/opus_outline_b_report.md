# Task B: outline weak spots (v3 variant, interpolation)

18 Nov 2026. Research use only, no clinical claims. Same data and split as `notes/opus_report.md`: 295 clicks, 59 scans, 31 patients, split by patient (`longmarker-tool/work/out/split.json`), settings chosen on the tuning half (16 patients, 150 clicks), numbers below from the held-out half (15 patients, 145 clicks) unless marked. Nothing committed; `app/`, plan, tracker, gap review untouched.

## Summary

- **Chest-wall exclusion: did not work.** No setting reduced leaks without losing tumours that touch the pleura or mediastinum. Held-out leak rate did not move (16% either way) when it was applied to the grow-back only.
- **Size-aware grow-back for small nodules: works on held-out, but costs 10-40 mL tumours.** Preset `V3_PRESET` raises held-out median Dice 0.742 to 0.777, small nodules (<2 mL) 0.73 to 0.78, and cuts leaks 16% to 12%. Tumours of 10-40 mL get worse (0.67 to 0.63; under-grown 16% to 24%).
- **Not clearly enough to change the default.** The tuning half gained only 0.772 to 0.78, and I picked among about 24 settings on 16 patients. v2 stays the default; v3 is opt-in.
- **Slice interpolation works** for brush edits: drawing every 3rd slice and interpolating skips about 63% of slices at Dice 0.94 to 0.95 against the expert outline (every 2nd: 47% skipped, 0.965).
- **Core change is safe to sync into the app**, because the default behaviour is identical to v2 (checked, see Verification). Syncing is optional; nothing in the app needs it.

## What I changed (only `longmarker-tool/core`)

- `core/src/clickoutline_v3.js`: copy of v2, same `outlineFromClick` signature, defaults reproduce v2. New options: `wallMm` (limit the hull to the learned lung mask dilated by N mm), `wallShell` (apply that limit to the grow-back only, not the dense core), `shellK` and `shellAdd` (grow-back distance = min(10 mm, shellK x thickness + shellAdd)). Exports `V3_PRESET = { wallMm: 5, wallShell: true, shellK: 1.5, shellAdd: 1 }`.
- `core/src/interp.js`: `interpolateSlices(mask, dims, sp, keys)`: blends the signed 2D distance of the two nearest drawn slices and thresholds at zero. An empty drawn slice means "the tumour ends here".
- `core/scripts/eval_interp.mjs`: the interpolation evaluation. The click sweeps reuse `eval_v2.mjs` with the v3 module.
- `review/click_v3_results.csv`: per click, v2 and v3 rows (`variant`, `split`, size class, Dice, volume ratio to expert).

## Held-out results (145 clicks)

| | median Dice | ≥0.7 | ≥0.5 | empty | leak >2x | under <0.5x |
|---|---|---|---|---|---|---|
| v2 default | 0.742 | 63% | 85% | 0% | 16% | 5% |
| v3 preset | 0.777 | 65% | 90% | 0% | 12% | 8% |

By expert volume:

| size | clicks | v2 median Dice | v3 median Dice | v2 leak | v3 leak | v2 under | v3 under | v3 ≥0.5 |
|---|---|---|---|---|---|---|---|---|
| <2 mL | 30 | 0.73 | **0.78** | 33% | 17% | 0% | 0% | 83% (v2 67%) |
| 2-10 mL | 50 | 0.74 | 0.75 | 8% | 6% | 0% | 0% | 94% (v2 90%) |
| 10-40 mL | 45 | 0.67 | **0.63** | 20% | 20% | 16% | **24%** | 84% (v2 84%) |
| >40 mL | 20 | 0.88 | 0.88 | 0% | 0% | 0% | 0% | 100% |

Per click, v3 is more than 0.05 Dice better than v2 on 13% of clicks and more than 0.05 worse on 3%; the median per-click difference is 0.00. The gain is concentrated in small nodules (half of the <2 mL clicks improve; 3% get worse) and the loss in 10-40 mL (7% of those clicks get worse, none better). Tuning half, for reference: v2 0.772 / v3 0.78 (<2 mL: 0.48 to 0.58, 10-40 mL: 0.64 to 0.66, so the 10-40 mL loss did not show there).

What got worse: 10-40 mL tumours under v3 (median Dice down 0.04, under-growth up 8 points); the overall under-growth rate (5% to 8%). The shorter grow-back cuts hazy margins on those tumours, the same trade-off already seen in the v2 report.

## The three ideas, one by one

1. **Chest-wall exclusion.** Tried limiting growth to the hull AND the learned lung mask dilated by 2, 4, 6, 8, 12 mm. Tuning half, median Dice: 0.53, 0.60, 0.64, 0.71, 0.77 (v2: 0.77); leaks fall to 1-9% at the small settings but under-growth rises to 20-41% and empty clicks to 3-7%, because the learned mask misses tumours that touch the pleura or mediastinum. At 12 mm it does nothing. Limiting only the grow-back (the core still uses the full hull) at 3 to 12 mm: tuning half unchanged to ±0.01; held-out leaks unchanged (16%). The paravertebral and mediastinal leaks are within a few mm of the learned mask, so a distance rule cannot tell them from tumour that touches the wall. I did not find a working exclusion; those leaks still need the brush or an inward drag.
2. **Size-aware tolerance.** The grow-back distance scaled with the core's thickness, so small nodules cannot follow a vessel for 10 mm. Several settings (K 1 to 4, add 0 to 4) on the tuning half: most were within ±0.02; K 1.5 add 1 raised the <2 mL median 0.48 to 0.52-0.58 with no loss overall on the tuning half, and was my pick (also the best by ≥0.5, 0.75). It is the whole held-out gain above. Of note, shorter grow-back (K 1 add 1, K 1.5 add 0) lost Dice overall on the tuning half.
3. **Slice-to-slice interpolation (brush edits).** Simulated user: draws every k-th slice of the tumour exactly like the expert, plus first and last, and the tool fills the rest. Median over scans, held-out half (the tuning half is within 0.01; no parameter was tuned, k is a user choice):

   | key every | slices not drawn | Dice, interpolated | Dice, copy nearest drawn slice |
   |---|---|---|---|
   | 2nd | 47% | 0.965 | 0.950 |
   | 3rd | 63% | 0.944 | 0.934 |
   | 4th | 71% | 0.928 | 0.913 |
   | 5th | 75% | 0.908 | 0.890 |
   | 6th | 78% | 0.894 | 0.869 |

   All 59 scans: with every 3rd slice 8.5% of tumours fall under Dice 0.90 and the worst is 0.80; with every 4th 22% fall under 0.90 (worst 0.70); with every 6th 56% (worst 0.22, a very elongated tumour). The tumours have a median of 28 slices. Interpolating beats copying the nearest slice by 0.01-0.025 Dice. **Brush time:** drawing every 3rd slice cuts about 63% of slice edits, so a brush fix of say 12 slices becomes about 4-5 slices if the user marks only the corrections. These are slice counts, not measured times (no user timing). Limits: the key slices here are perfect expert ones; a user's own key slices will be noisier, and the interpolated slices are not checked against the image, so volume and long-axis from a fully interpolated outline should still be viewed in the slice viewer. The interpolation is not wired into the app (no UI work done).

## Failures and caveats

- The overall v3 gain is mostly small nodules, and the 30 small-nodule clicks come from few patients (the tuning half has only 3). Its per-patient confidence interval is wide; do not treat 0.73 to 0.78 as established.
- The held-out half was seen before in the v2 work, and I looked at held-out numbers after the sweep; I chose the preset from the tuning columns only, but my sweep tried about 24 settings in total.
- No fix for hazy edges (under-outlined) was tried: not in this task.
- Leaks near the mediastinum or posterior wall remain about 1 click in 8 (v3) or 1 in 6 (v2).

## Verification

- v3 with default options reproduces v2 exactly on the sweep: held-out 0.742 / 63% / 85% / 16% leak, tuning 0.772, identical to `notes/opus_report.md`.
- The Dice values come from `eval_v2.mjs` (same scorer as v2). I did not rerun the independent Python scorer on v3; the interpolation Dice uses the same simple overlap formula. Nothing was checked on real follow-ups.

## Syncing into the app

Safe: `clickoutline.js` is not modified; `clickoutline_v3.js` and `interp.js` are new files and import only `morph.js`. If `sync-core.sh` copies all of `core/src`, the app gets them unused. To try the preset, import `outlineFromClick` and `V3_PRESET` from `clickoutline_v3.js` and pass `{ ...V3_PRESET }`; I recommend waiting for a larger set of small nodules before making it the default. For brush interpolation the app would call `interpolateSlices(mask, dims, spacing, sortedKeySlices)` on the outline after an edit.
