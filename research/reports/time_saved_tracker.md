# Time saved tracker: click-to-outline tool

> Working document. Current figures and the final framing are in `docs/RESULTS.md`; this file keeps the time model, the measuring method and the trial protocol.

Last updated 17 Nov 2026 (time log added to the app). Research use only.

## Purpose

This tracks how many minutes the click-to-outline tool saves per scan, and whether measurement quality holds.

To log a run:

1. Pick a practice scan and time each step with a stopwatch, once by hand (no tool) and once with the tool.
2. Fill one row per run in the trial log below.
3. Compare the outline with the expert outline and record the overlap (Dice).
4. Copy the averages into the results table.

## Baseline

Daniel's own estimates, given in #project-kickoff on 17 Nov 2026. A typical scan has 1 to 3 tumours; the model below assumes 2.

| Step | Daniel's estimate | Unit |
| --- | --- | --- |
| Finding tumours (two passes through 250-400 slices) | 10-20 min | per scan |
| Measuring long and short axes | 2-4 min | per tumour |
| Typing one row into the sheet | 3-5 min | per tumour |
| Full outline for volume (done on about 1 in 5 tumours) | 15-25 min | per tumour |
| Matching a tumour on a follow-up scan | about 10 min | per follow-up |

## Model

With click-to-outline and the automatic sheet row, a scan with 2 tumours drops from about 37 to about 21 minutes (43% less), and a follow-up from about 47 to about 24 (49% less). Finding is untouched, so about half is the ceiling.

| Step (scan with 2 tumours) | Today (min) | With tool (min) | How the numbers come about |
| --- | --- | --- | --- |
| Finding | 15 | 15 | midpoint of 10-20; no change, Daniel keeps his plain scroll |
| Measuring axes | 6 | 0 | 2 x 3 min today; the tool measures from the outline |
| Typing rows | 8 | 1 | 2 x 4 min today; 2 x 0.5 min to fill type, solid component, notes |
| Outlines for volume | 8 | 5 | today 0.4 tumours x 20 min; with the tool 2 x 2.5 min to click, check, edit |
| **Baseline scan total** | **37** | **21** | saves 16 min |
| Matching on a follow-up | 10 | 3 | with a proposed outline to confirm or fix |
| **Follow-up scan total** | **47** | **24** | saves 23 min |

The with-tool figures are assumptions (2.5 min to click and edit a tumour, 3 min to confirm a matched outline). Replace them with the app's time log (see below) or the trial log.

## Measuring it in the app

The app now keeps this tracker itself. The timer in the header counts **active minutes** per scan and can be paused (button, or `P`); it is saved per scan, so a reload does not lose it. It records when the first outline click happens (end of finding) and when each row is added. The **time log** (click the timer) lists, per scan: tumours (rows added), finding minutes (load to first click), outline-and-rows minutes (first click to the end), total with the tool, the by-hand model for that many tumours (15 min + 11 min per tumour, from Daniel's estimates above) and the difference. It exports to CSV (`time_log.csv`).

How to use it for the results: for each practice scan, load it, work as Daniel would (find, click, edit, add rows), and read the row off the log. The by-hand column is still the model, so the saving stays "modelled" until Daniel times real scans by hand once; his hand timings replace the model column in the CSV. The "Minutes on scan" cell of each sheet row uses the same active time.

What the log cannot show: the first minutes include anything done before the click (reading the scan), so finding is slightly overstated; the lung model's 30 s background run does not stop the timer (the user can keep working); one person doing a practice scan twice learns the scan, so use different scans for hand and tool timings.

## Trial log

Template, not filled in (the lab contact's stated runs, further down, took its place). Three practice scans of different size, each timed by hand and with the tool. Manual means 3D Slicer with a ruler and freehand outline (see `review/MANUAL_REVIEW_GUIDE.md`). Fill the empty cells in minutes; finding is the same in both, so time it once if you prefer.

| Scan | Tumour | Method | Finding (min) | Measure and outline (min) | Row entry (min) | Matching (min) | Total (min) | Dice vs expert | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RIDER-1801720707 TEST | 12 mm nodule | Manual | | | | | | | |
| RIDER-1801720707 TEST | 12 mm nodule | Tool | | | | | | | |
| RIDER-1286684383 TEST | about 3 mL | Manual | | | | | | | |
| RIDER-1286684383 TEST | about 3 mL | Tool | | | | | | | |
| RIDER-1129164940 TEST | 58 mm mass | Manual | | | | | | | |
| RIDER-1129164940 TEST | 58 mm mass | Tool | | | | | | | |
| RIDER-1129164940 RETEST | same mass, matching | Manual | | | | | | | |
| RIDER-1129164940 RETEST | same mass, matching | Tool | | | | | | | |

## Results so far

No stopwatch-timed trials yet, so time saved is the model above (43% per baseline scan, 49% per follow-up); the lab contact's stated runs (below) are in the same range. Outline quality has been scored on all 59 practice scans with simulated clicks (5 per scan, 295 clicks) against the expert outlines (`review/click_sweep_results.csv`).

| Measure | Value | Status |
| --- | --- | --- |
| Time saved, baseline scan | 16 min of 37 (model) | to be replaced by trial log |
| Time saved, follow-up scan | 23 min of 47 (model) | to be replaced by trial log |
| Outline overlap with expert, best single setting | median Dice 0.62; 41% of clicks reach 0.7 | measured, 17 Nov 2026 |
| Outline overlap, best of 24 settings per click (what one drag adjustment can reach) | median Dice 0.76; 63% reach 0.7; 88% reach 0.5 | measured; upper bound, picks the best setting using the expert outline |
| Outline overlap, click-to-outline v2 (held-out half, 15 patients, 145 clicks) | median Dice 0.74; 63% reach 0.7; 85% reach 0.5; 0% empty | measured 17 Nov 2026 in the research folder; not yet in the app (see notes/opus_report.md) |
| Clicks that return no outline | 10% on the best single setting; 1% with the lung limit switched off | measured |
| Same-day repeat scans, volume difference | 9.5% on average, up to 33% | reference for how close is close enough |

Overlap is best on the largest tumours and weakest on small ones; v2 is worse than v1 under 2 mL (0.73 vs 0.79). About 1 click in 6 still leaks, so the brush and drag are expected to fix it. Details: notes/opus_report.md.

## Caveats

The time figures are modelled from Daniel's estimates, not measured on him, and must be labelled that way in the results.

- Daniel and Naomi are simulated; the baseline is what they said, not a stopwatch measurement.
- Typing and measuring may overlap in Daniel's numbers; if so, the saving is a few minutes lower.
- The with-tool times (2.5 min per tumour, 3 min to confirm a match) are assumptions until the trial log is filled.
- Finding is unchanged, so the 40-to-10-minute target is out of reach; about half is the ceiling.
- The practice set has one outlined tumour per scan, and its repeat scans are minutes apart, not months, so matching is only approximated.
- The best-of-24 overlap uses the expert outline to choose the setting, so it is an upper bound on what a user dragging by eye gets.
- Axis numbers are approximate, not a clinical (RECIST) measurement. Research use only.

## Protocol for Daniel's lab-machine trials (added 18 Nov 2026)
Daniel is setting up a lab machine (no patient data, web access) this week. Per scan he reports his usual by-hand time for each step on the same tumours; the app's time log (CSV export) gives the tool minutes.
- Sample: at least 5 baseline tumours and 5 follow-up pairs, on different scans for hand and tool timing (he should not learn a scan). Say the sample size in the results.
- Per baseline tumour: tool minutes (time log: finding, outline and rows) against his by-hand minutes (finding, measuring, typing, outline if done).
- Per follow-up: tool minutes with "Match to baseline" against his usual matching time; mark the matched place as right, moved, or re-clicked; note Confident or Uncertain; count wrong Confident proposals.
- Quality: the tool's long axis and volume against his usual ruler measurement and freehand outline on the same tumours (mm and %), against the reference that same-day repeats differ by about 3 mm and 9.5%.
- Report medians and ranges, and keep modelled and measured numbers in separate rows. Wait times of the lung model (30 s on WebGPU, about 3 min on a CPU, twice for matching) are not active minutes but should be noted.

## Reported runs (18 Nov 2026, Daniel, simulated lab contact; stated, not measured)
20 baseline scans (32 tumours), 10 follow-up scans (15 matches). Baseline 15-20 min with the tool against his usual 30-40 (about 50% less); follow-up about 15 against 25+ (about 40% or more). Matches: 10 right as-is, 4 minor edge adjustments, 1 re-click. Brush on spiculated or hazy edges adds about 2-3 min per tumour. No freezes. Missing: time log and edit trail CSVs, per-tumour times. Model for comparison: 37 to 21 min (43%) and 47 to 24 (49%).
