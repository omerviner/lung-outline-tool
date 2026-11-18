# What the lab told us (source: #project-kickoff, 17 Nov 2026)

## Workflow (Daniel Reyes, research fellow)
- Loads the thin axial series (1.0 or 1.25 mm) in a lung window; scrolls 250-400 slices twice to find nodules.
- Measures long and short axis (ruler tool) on the slice where the nodule looks largest.
- Freehand outline on every slice for volume; he does this for only about 1 in 5 tumours because it is slow.
- Follow-ups: previous scan on a second monitor, matched by landmarks (vessels, fissures); slice numbers shift with breathing.
- Viewer exports only screenshots; real scans stay inside the hospital network.

## Sheet (Excel), one row per tumour
patient ID, date, timepoint, series number, slice thickness, nodule ID, lobe, slice number, type, long axis, short axis, mean diameter (calculated), solid component, volume, match status, minutes on scan, initials, notes.
- A CSV he can paste into the Excel sheet is enough for the pilot.
- He offered to walk through example rows: take him up on it before building the export.

## Baseline timings per scan (Daniel's estimates)
| Step | Time |
|---|---|
| Finding | 10-20 min |
| Measuring diameters | 2-4 min per tumour |
| Full outline for volume | 15-25 min per tumour, done on about 1 in 5 |
| Matching on a follow-up | about 10 min |

## Requirements and priorities
1. Finding is the biggest time sink: reliable candidates first (a miss costs more than an extra mark).
2. Proposals must be easy to check, edit and correct. Accept/reject alone is not enough: he must be able to fix the outline edges.
3. Then fast outline correction with volume and diameters, then follow-up matching.
4. Pilot: public data, in the browser, no IT review (Naomi). Research use only.
5. Success for Naomi: one narrow bottleneck solved well for the lab meeting.
