# Daniel's sheet format (received 18 Nov 2026)

Columns, in order: Patient ID, Scan date, Timepoint, Series, Slice thickness, Nodule ID, Lobe, Slice, Type, Long axis, Short axis, Mean diameter, Solid component, Volume, Match to prior, Minutes, Initials, Notes.

Example rows (made-up values he supplied):
```
HTL-0001, 2025-01-14, Baseline, 3, 1.25, N1, Right Upper Lobe, 142, Solid, 14.2, 11.0, 12.6, , 1180, , 35, DR, Clear edges
HTL-0001, 2025-07-22, Follow-up 1, 3, 1.25, N1, Right Upper Lobe, 139, Solid, 15.0, 11.6, 13.3, , 1395, Confident, 41, DR, Slight growth
```
Rules: volume in mm3 (whole number), date YYYY-MM-DD, slice counted from 1, diameters in mm with one decimal, timepoints "Baseline" / "Follow-up 1" / ..., types "Solid", "Part-solid", "Ground-glass", full lobe names ("Right Upper Lobe"), "Match to prior" blank on baseline and Confident/Uncertain on follow-ups, minutes whole numbers in his examples (the app exports one decimal).
Workflow facts: follow-ups are typically a few months apart; he keeps baseline measurements in his sheet and has no separate outline files; copying Nodule ID, Lobe and Type from the baseline row would save time.
Applied in the app: headers, order, timepoint default and list, lobe and type drop-downs, volume mm3.
Not applied: importing his baseline rows (the tool cannot read his sheet yet); a baseline outline must still be made in the tool before Match to baseline works.
