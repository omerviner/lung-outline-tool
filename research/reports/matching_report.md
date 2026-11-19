# Follow-up matching: method, held-out results, failures

18 Nov 2026. Research use only, no clinical claims. Data: RIDER Lung CT (TCIA, CC BY). Lung mask: LungMask R231 (Apache-2.0).

## Summary

- `proposeMatch(baseline, follow)` in `longmarker-tool/core/src/match.js` proposes a seed on the follow-up scan; `outlineFromClick` then grows the outline from it, so it is editable like any click outline. Plain JavaScript, no new dependencies, about 1.7 s per match in Node.
- **Held-out (14 patients, 28 pair-directions, minutes-apart scans): the proposed seed lands inside the expert outline in 28/28 (100%), median centre error 1.5 mm, median Dice of the resulting outline 0.77 (68% reach 0.7).** Same-slice-index copy: 43% hit, median Dice 0.28. Same patient-space position (DICOM geometry): 29% hit, Dice 0.00. So the baselines are beaten by a wide margin.
- **The matching is no longer the limit; the outlining is.** Growing the outline from the *expert's own centre* gives the same held-out median Dice (0.77). Where the proposal is wrong in Dice terms, it is the click-outline failures from `outline_v2_report.md` (small nodules, leaks), not a wrong place.
- **This is an easy test.** The two scans of a pair are minutes apart, same session, same breath-hold protocol, no growth. It shows that the machinery finds the right place when the anatomy is the same. It says nothing about months-apart growth, treatment response, or different positioning. Do not read 100% as a claim about real follow-ups.

## Method

Every stage is returned in `stages`, so each can be scored alone.

1. **index**: same slice index and pixel.
2. **geometry**: same patient-space point, from each scan's ImagePositionPatient (`origin` of grid voxel 0,0,0).
3. **rigid**: rigid registration of the two lung masks (the learned masks in `work/lung_ds`). Translation, then a rotation about the table axis (yaw, -6 to +6 degrees), coarse to fine (9 mm, 4.5 mm, 3 mm sampling). The score is lung Dice inside the field of view shared by the two scans (the scans cover different z ranges, up to 68 slices apart).
4. **local (the proposal)**: normalised cross-correlation of a patch of the baseline (ellipsoid of radius = tumour equivalent radius + 12 mm, clamped to 14-28 mm, HU clipped to -1000..150) against the follow-up, in a window of +-25 mm around the rigidly mapped point. The follow-up is first resampled into the baseline frame so the rotation is already applied. Coarse search on a 2-voxel lattice, then full-resolution refinement around the best position.
5. The proposed seed is the baseline click moved by the NCC shift and the rigid map.

**Confidence ("Confident" / "Uncertain").** Features: NCC peak, margin (NCC peak minus the best NCC at least 10 mm away: "is there a look-alike place?"), difference in mean HU (3 mm ball) between the baseline seed and the proposed seed, and the size of the NCC correction beyond the lung alignment. Thresholds were chosen **on the tuning half only**, pooling every perturbation run, with the target "at least 90% of Confident proposals hit": NCC >= 0.3, margin >= 0.3, HU difference <= 150. (The rigid-correction limit was not selected, so it is off.) They were then applied unchanged to the held-out half.

## Protocol

- Pairs: the 28 same-day TEST/RETEST pairs, 56 pair-directions, patients split as in `work/out/split.json` (tuning 14 patients, held-out 14; the 3 patients with a single scan have no pair).
- Baseline = the expert outline of one scan with the simulated centre click (`jobs.json`, seed 0). Target = the expert outline of the other scan. Metrics: hit (seed inside the expert outline), centre distance in mm, Dice and volume error of the outline grown from the proposed seed, time-to-confirm proxy = hit (a hit means "confirm", a miss means "re-click").
- **Honesty about tuning.** The four methods and their parameters (search window, patch size, sampling) were fixed in advance, not tuned. I looked at all-pair numbers (both halves) once before the confidence rule existed. The only chosen numbers are the confidence thresholds, chosen on the tuning half. Still, a few design choices (for example the yaw range) were made after I saw that the first run worked, so some optimism is possible.
- Independent check: `core/scripts/check_match.py` recomputes Dice and volume error from the saved masks and the hit and centre distance from the saved seeds, with numpy and no shared code. Differences to the JS numbers: Dice at most 0.0005 (rounding), 0 mismatches in hit and distance over 56 rows.

## Held-out results (14 patients, 28 pair-directions, scans minutes apart)

| stage | hit | median centre error | median Dice | Dice >= 0.7 | median abs volume error |
|---|---|---|---|---|---|
| 1 same slice index and pixel | 43% | 15.3 mm | 0.28 | 29% | 97% |
| 2 same patient-space position | 29% | 23.1 mm | 0.00 | 7% | 100% |
| 3 + rigid lung registration | 93% | 3.4 mm | 0.75 | 64% | 19% |
| **4 + local NCC (proposal)** | **100%** | **1.5 mm** | **0.77** | **68%** | **22%** |
| expert-centre click (outlining ceiling) | | | 0.77 | | |

Tuning half, for reference (it chose the confidence thresholds): proposal hit 96%, Dice 0.77, volume error 33%; the miss is the odd scan below.

Notes: geometry alone is *worse* than slice index here, so the DICOM positions are not a shared patient frame in this dataset (centres 23 mm apart, origins differ by tens of mm). Plain copy of the baseline outline into the follow-up gives Dice 0.11 median.

By target size (all 56 rows): under 2 mL 12/12 hits, Dice 0.63; 2-10 mL 18/18, 0.77; over 10 mL 25/26, 0.85. Small nodules are hit but outlined worse, as in `outline_v2_report.md`.

**Confidence, held-out, unperturbed pairs:** 26 of 28 proposals are "Confident" (100% hit, median Dice 0.80), 2 "Uncertain" (also hits, Dice 0.69). On the tuning half the rule marks 14 of 28 "Uncertain" although all 14 of those are hits, so it is conservative; Daniel would be asked to look at about a quarter to a half of the proposals that are in fact right. Across all perturbation runs pooled, the held-out "Confident" set (67% coverage) hit 100%; the "Uncertain" set hit 62% (the tuning half: 93% and 85%, so the rule is looser there; the held-out numbers are the better-behaved half and I would not promise 100% elsewhere).

## Robustness test

The follow-up scan was moved before matching (its lung mask and expert outline moved with it; the DICOM positions were left unchanged, as with a different patient position on the table). 56 pair-directions per condition; held-out half shown; the tuning half is similar (`core/scripts/tune_conf.mjs` prints both).

| perturbation | rigid stage hit | **proposal hit** | proposal Dice | NCC alone (no lung registration), hit / median centre error |
|---|---|---|---|---|
| none | 93% | **100%** | 0.8 | 75% / 1.9 mm |
| shift 5-10 mm | 89% | 100% | 0.8 | 75% / 1.9-2.5 mm |
| shift 20 mm | 89% | 100% | 0.8 | 68% / 3.0 mm |
| shift 30 mm | 93% | 100% | 0.8 | 54% / 8.0 mm |
| shift 60 mm | 93% | 100% | 0.8 | not run |
| shift 80 mm | 80% | 100% | 0.8 | not run |
| z shift 30 mm | 93% | 100% | 0.8 | 61% / 9.3 mm |
| in-plane shift 30 mm | 93% | 100% | 0.8 | 57% / 9.4 mm |
| rotation 3, 6 degrees | 93% | 100% | 0.8 | 75% |
| rotation 10 degrees | 75% | 100% | 0.8 | not run |
| rotation 15 degrees | 50% | 100% | 0.7 | not run |
| scale +5% / -5% | 75% / 82% | 100% | 0.8 | 75% (+5%) |
| scale +10% | 54% | 100% | 0.8 | not run |
| shift 15 mm + 3 deg + 5% | 75% | 100% | 0.8 | 68% |

What this does and does not show:
- **The lung registration is what makes the proposal robust.** Without it, the local NCC search (25 mm window) breaks from about 20 mm of displacement: hit rate falls from 75% to 54-61% and the median error from 2 mm to 8-9 mm at 30 mm. With it, shifts up to 80 mm and rotations up to 15 degrees are absorbed.
- **That is a strength of the test as much as of the method.** Here the lungs are the same lungs, moved rigidly, so lung alignment is easy and the NCC step only has to fix a small remainder. Real follow-ups change the lungs (different inspiration, new effusion, atelectasis, a growing mass), and then the lung-mask alignment will be off by an unknown amount and the 25 mm NCC window may not catch it. I did not test non-rigid change (different inspiration depth), so **I cannot say where the full pipeline breaks.** Scale +-10% and rotation 15 degrees already halve the rigid stage's hit rate (the NCC step rescues it here).
- At shift 80 mm, 3 of 28 held-out and 4 of 28 tuning pair-directions are missing from the table (25 and 24 rows). I did not look into why; the likely cause is that the moved expert outline leaves the volume, so there is nothing to score. Unverified.
- **No real-follow-up check was possible**: there is no pair in this dataset months apart.

## Failures (the proposal stage, all 56 rows)

Hit but a poor outline (Dice < 0.3, seed 0.8-1.8 mm from the expert centre): RIDER-2073083717 both directions (5-6 mL), RIDER-9763310455 both directions (0.9 mL). These are outline failures on small or ill-defined nodules (the same weakness as in `outline_v2_report.md`), not matching failures. The confidence rule marks all four "Uncertain" ("ambiguous: second look-alike place", margin 0.18-0.28), which is a useful flag even though the reason is partly the nodule itself.

One miss: **RIDER-2669524182, RETEST to TEST (22 mL), seed 1.4 mm from the expert centre but outside the outline, empty outline, flagged "Confident"** (NCC 0.89, margin 0.48). This is the scan the earlier notes already flag (the expert outline does not match the CT; seed about -800 HU inside it). I treat it as a data problem, not a method failure, but it is a confident wrong answer in the table and counted as a miss everywhere above.

## What the user must still correct

- Confirm or fix every proposal. In the model the time saving (about 10 min to about 3 min) needs the proposal to be a hit; on these pairs it always is except the odd scan, but that is the easy case.
- **Treat "Confident" as a hint, not a guarantee.** It was 100% right on held-out pairs and still produced one confident wrong answer in the tuning half. "Uncertain" should be shown to Daniel as "check the location first".
- Check the outline itself, especially for nodules under 2 mL (median Dice 0.63) and where the outline leaks; the brush and drag are still needed.
- For real follow-ups months apart, check the location and the size by eye: the proposal assumes the tumour looks like the baseline and sits roughly where rigid lung alignment says. Growth and different inspiration are untested.

## Calling it from the app (not wired; I did not touch `app/`)

```js
import { proposeMatch } from './core/match.js';   // after app/scripts/sync-core.sh
const r = proposeMatch(
  { vol, dims, spacing, mask, seed, lung, origin },   // baseline grid data, its saved outline (decoded) and click, lung mask, origin (optional)
  { vol, dims, spacing, lung, origin });              // follow-up grid data
// r.seed -> [z,y,x] on the follow-up grid: call outlineFromClick(vFollow, dimsF, spF, lungF, r.seed) and load the result as a new tumour
// r.confidence.level -> 'Confident' | 'Uncertain' (sheet "Match status"), r.confidence.reasons -> text for the tooltip
```
`origin` is `[z, y, x]` in mm of grid voxel (0,0,0): z from the first slice position, x/y from ImagePositionPatient plus (DS-1)/2 pixels. Without it the geometry stage is the same as the index stage and the rigid stage still works. It needs the lung mask of both scans (the app has the learned mask for the open scan; the baseline's must be computed or stored). `core/src` has **not** been synced into `app/src/core` (the brief said not to touch the app): run `app/scripts/sync-core.sh` when wiring.

## Files

- `longmarker-tool/core/src/match.js`: `proposeMatch`, `MATCH_DEFAULTS`.
- `longmarker-tool/core/scripts/cache_scans.mjs` (DICOM to downsampled volume + geometry cache), `score_match.mjs` (runs and scores, perturbations via `--perturb`, `--nolung`), `tune_conf.mjs` (robustness tables, confidence rule), `summarize_match.mjs` (stage table per half), `check_match.py` (independent check).
- `review/match_results.csv`: one row per pair and direction (unperturbed): per stage hit, centre error, Dice, volume error; oracle Dice; confidence, reasons and features; proposed seed.
- Perturbation runs: `longmarker-tool/work/out/match_run*/` (not copied to `review/`).

Task B (outline weak spots) was not started.
