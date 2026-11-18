# Lung Outline Tool: results

Research use only. Not a medical device; no clinical claims. Data: TCIA RIDER Lung CT and RIDER-LungCT-Seg (CC BY). Last updated 18 Nov 2026. Status: tool built and live; **time saved is modelled from the lab's own estimates and is not yet measured on the lab**: Daniel's timed trials are pending (see "How the time saved is measured").

- Tool: https://omerviner.github.io/lung-outline-tool/ (runs in the browser; scans never leave the machine)
- Source and run instructions: https://github.com/omerviner/lung-outline-tool (`npm ci && npm run dev`)

## The problem and the choice made
For each scan, a researcher scrolls 250 to 400 slices twice to find tumours, measures them with a ruler tool, outlines about 1 in 5 for volume (15-25 min each), types a row into the sheet, and on follow-ups spends about 10 min matching each tumour to the previous scan. I asked the lab what they wanted. They declined automatic finding (a miss costs more than an extra mark; they keep their own double pass) and asked for: **click a tumour, get a 3D outline, drag to resize, a brush for hazy edges, live volume and diameters, one sheet row per tumour, and help on follow-ups.** That is what was built; finding is deliberately untouched.

## What was built
- **Click-to-outline.** Click a tumour; the 3D outline, volume (mm3) and long, short and mean diameter appear at once. Drag outward or inward to resize (preview while dragging, exact when you stop), tolerance slider for hazy edges, brush and eraser that paint through up to 15 slices, undo, several tumours per scan saved in the browser.
- **Sheet row.** One row per tumour in the lab's own 18 columns and wording (Baseline / Follow-up 1 timepoints, lobe and type drop-downs, volume in mm3, dates YYYY-MM-DD, slice from 1). Copy rows pastes into Excel; CSV download. The row fills patient, date, series, thickness and slice from the DICOM header, and Minutes from an active-time clock.
- **Follow-up matching.** "Match to baseline": from a baseline scan's saved outline, propose the tumour on the open follow-up (lung registration, then a local image match), flagged Confident or Uncertain. "Paste baseline rows" lets the follow-up inherit nodule ID, lobe, type and the next timepoint from the lab's own sheet.
- **Lung model in the browser.** LungMask R231 (Apache-2.0) via ONNX Runtime Web keeps outlines inside the lung: about 30 s per scan with WebGPU, about 3 min on a CPU (every third slice; the lung mask keeps Dice 0.99 against all slices). Outlines work while it runs.
- **Time measurement built in.** Active-time clock with pause, a per-scan time log (finding, outline and rows, total, by-hand model) with CSV export.

## What works (measured)
**Outline quality**, against the expert outlines (59 scans, 31 patients, 295 simulated clicks, five per scan, split by patient: tuned on 16 patients, scored on the other 15, 145 clicks):

| | median Dice | clicks at Dice 0.7 or above | at 0.5 or above | empty | leaks (over 2x volume) | median volume error |
|---|---|---|---|---|---|---|
| First version (best single setting) | 0.59 | 43% | 55% | 3% | 33% | 58% |
| **Click-to-outline v2 (what the app runs)** | **0.74** | **63%** | **85%** | **0%** | **16%** | **22%** |
| Ceiling: best of 24 settings per click, picked with the expert outline | 0.78 | 68% | 93% | | | |

By tumour size (held-out median Dice): under 2 mL 0.73, 2-10 mL 0.74, 10-40 mL 0.67, over 40 mL 0.88. For reference, same-day repeat scans of the same tumour differ by about 9.5% in volume on average (up to 33%) and about 3 mm in long axis. Some optimism is possible: held-out numbers were visible while tuning.

**Follow-up matching**, on the 28 same-day test-retest pairs scored in both directions (56 pair-directions, patients split, held-out half = 28):

| | seed lands inside the expert outline | median distance to the expert centre | median Dice of the resulting outline |
|---|---|---|---|
| Same slice index | 43% | 15.3 mm | 0.28 |
| Same patient-space position (DICOM geometry) | 29% | 23.1 mm | 0.00 |
| **Lung registration + local image match (what the app runs)** | **100% (28 of 28)** | **1.5 mm** | **0.77** |

The result survives shifts up to 80 mm and rotations up to 15 degrees of the follow-up scan. 26 of 28 proposals were Confident (all hits); two Uncertain, both also hits. The matching is no longer the weak step; the outlining is (the same Dice 0.77 starting from the expert's own centre).

**Speed.** Drag preview about 11 ms median, exact outline 0.4 to 0.6 s. The lung model run is in the background and does not block clicking.

## What fails or is weak (plainly)
- **About 1 click in 6 leaks** (over 2x the expert volume): small nodules beside vessels, tumours against the chest wall, spine or mediastinum. The drag inward or the brush fixes it, but it costs time. 15% of held-out clicks are still below Dice 0.5.
- **Small nodules under 2 mL are worse than the first version** (median Dice 0.73 against 0.79; one in three needs fixing). An attempted size-aware fix helped the tuning half and hurt the overall median, so it was not adopted.
- **Hazy, ground-glass or spiculated edges** are under-outlined (the solid part, not the rim); lowering the tolerance usually recovers them.
- **Matching is only validated on easy pairs.** The two scans of a pair are minutes apart (same session). Months-apart growth, different breathing depth and new findings are untested; the numbers say nothing about them. One Confident proposal was wrong, on a scan whose expert outline does not match the CT (treated as a data problem).
- **No automatic finding.** Tested (lung mask plus blob finder found 32 of 59 expert tumours, weak under 2 mL and over 40 mL), declined by the lab, left out.
- **No slice-to-slice interpolation in the app yet.** The method works in the research code (drawing every 3rd slice and interpolating the rest keeps Dice 0.94 against the expert outline and skips about 63% of slice edits; these are slice counts, not measured times), but it is not wired in; the brush paints through several slices instead.
- **Leak fixes were tried and mostly failed.** A chest-wall exclusion did not reduce leaks without losing tumours that touch the pleura or mediastinum. A size-aware grow-back raised held-out small-nodule Dice from 0.73 to 0.78 but lowered 10-40 mL tumours (0.67 to 0.63), and the gain rests on few patients, so v2 stays the default.
- **The CPU path is slow** (about 3 min per scan, twice for matching) and WebAssembly multi-threading hung in the browser worker, so it is single-threaded. Needs WebGPU for about 30 s.
- **Quality of axes:** long and short axis come from the 3D outline and are approximate, not clinical (RECIST) measurements.
- **Only RIDER lung CT** (thin slices, one expert outline per scan) was tested. Thick-slice series show a warning; other scanners, protocols and tumour types are untested. Firefox and Safari are untested.

## How the time saved is measured
Daniel's by-hand baseline (his own estimates, 17 Nov): finding 10-20 min per scan; measuring 2-4 min per tumour; typing a row 3-5 min per tumour; full outline 15-25 min per tumour (done on about 1 in 5); matching about 10 min per follow-up. Typical scan: 1-3 tumours (modelled as 2).

**Model (not measured on the lab):**

| Scan with 2 tumours | Today (min) | With the tool (min) |
|---|---|---|
| Finding | 15 | 15 (unchanged) |
| Measuring axes | 6 | 0 (from the outline) |
| Typing rows | 8 | 1 |
| Outlines for volume (0.4 per scan today, every tumour with the tool) | 8 | 5 |
| **Baseline scan** | **37** | **21** (43% less) |
| Matching on a follow-up | 10 | 3 |
| **Follow-up scan** | **47** | **24** (49% less) |

Finding is unchanged, so about half is the ceiling; "40 to 10 minutes" is not reachable. The with-tool numbers (2.5 min to click, check and edit one tumour; 3 min to confirm a match) are assumptions, and Daniel may count typing inside measuring, which lowers the saving by a few minutes. The tool also gives a volume for every tumour, not only 1 in 5, which the model counts as extra value rather than time saved.

**What replaces the model (trials, in progress):** Daniel runs the tool on a lab machine (no patient data) on his own or practice scans and reports his usual by-hand time for the same tumours. For each scan, the in-app time log gives measured active minutes (finding, outline and rows, total) and exports CSV. Per tumour and per follow-up I collect:
1. Minutes with the tool (time log) against his by-hand minutes for the same step.
2. Whether the proposed outline was accepted, edited or redone; whether the matched place was right, moved or re-clicked; how often a Confident proposal was wrong.
3. Quality: the tool's long axis and volume against his usual ruler measurement and freehand outline on the same tumours (difference in mm and %), compared with the reference that same-day repeats differ by about 3 mm and 9.5%.
Report medians and ranges, not only means; use different scans for the by-hand and tool timings so he does not learn a scan; say how many tumours the sample holds. Until then every time-saved figure above is labelled "modelled".

## Limits of this evaluation
- The lab contacts are AI-simulated. The baseline timings are what they said, not a stopwatch.
- The practice set has one outlined tumour per scan, and the expert outlines are the only truth available; simulated clicks stand in for a person.
- Held-out tests were split by patient, with some optimism possible (see above). The outline and matching scores were checked with independent code (Python recomputes Dice and hit rate from the saved masks).
- Not a medical device; research use only.

## What I would do next
1. Daniel's timed trials on real follow-up pairs (months apart); fix what he reports.
2. Wire slice interpolation into the brush; revisit the size-aware grow-back on a larger set of small nodules; the 1-in-6 leaks still need the brush or an inward drag.
3. Re-score matching on any months-apart pair available; add a side-by-side baseline view.
4. Faster CPU path (quantised model) or require WebGPU.

## Where things are
Source: https://github.com/omerviner/lung-outline-tool (app in `src/`, algorithms in `src/core/`, research scripts, reports and result tables in `research/` and `docs/`). Reports: `research/opus_report.md` (outline method and scores), `research/opus_outline_b_report.md` (leak fixes and interpolation), `research/opus_match_report.md` (matching), `research/time_saved_tracker.md` (time model and trial log), `research/client_side_test.md` (browser model test).
