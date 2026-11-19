# Review of the Lung Outline Tool app (code and design)

Branch state: 17 local commits on top of `b0aeac0`, nothing pushed. `npm run build` passes. `src/core/` untouched; no true bug found there.

## Fixed (commit, file:line before the fix)

| Commit | Finding | Verified |
|---|---|---|
| e9bd33f | `App.jsx` worker `onmessage` (~409): a stale result (after N / delete / new scan) returned without posting the queued request, so the next click was silently lost. `openGroup` (~533) also never bumped `minId`, so a late result of the old scan could write into the new scan's mask. `inflight` was cleared by stale results. | Reproduced (click then N then click: second outline missing), fixed, re-ran: outlined. |
| 9d08430 | `outline.worker.js`: an exception left the page waiting forever (spinner, all later clicks queued). Now answers with an error; `worker.onerror` added. | Code only (no easy way to force an exception). |
| e3a1755 | `openGroup`: `buildVolume` had no try/catch; a bad series left "Building volume..." forever. | Code only. |
| a0a9558 | `TimePanel` CSV header "By hand, modelled (min)" was unquoted, so header had 8 fields vs 7 in rows. | Code only. |
| 01e9399 | `Viewer.jsx` Space handler called preventDefault on focused buttons and checkboxes (keyboard users could not press them). | Code only. |
| 862c203 | Shortcuts (Enter adds a row, Delete/Backspace clears) fired behind the match/series/paste dialogs; Escape did nothing in the match dialog (no focus); Cancel during "running" still produced a proposal; baseline volume (~80 MB) kept after closing; lung worker start-up failure never shown. | Reproduced and verified (Escape closes, Enter/Backspace ignored, match completes). |
| ee95c7f | `olPersist` dropped the match note: after reload the matched outline lost match status/lobe/type for new rows. Deleting the active outline left Fill-between keys. | Verified across reload. |
| 157ae41 | Trail said "added about 189 mm3" for a stroke inside the outline (volume unchanged); undo of a fill said "undid a brush stroke". | Verified. |
| 8b29ef0 | "Copy rows" failed silently without clipboard access. | Code only. |
| 5ca71aa | Trail "Match proposed" stamped 0 mm3 when stamped before the outline existed (seen in the browser pane). | Code only. |
| 78fe790, fb4f792 | At 1100 px the brand name overlapped "Lung Outline Tool"; the Timepoint field showed "Follo". | Screenshot at 1100. |
| e8de176 | Icon-only sheet buttons (below 1120 px) had no accessible name. | DOM check. |
| 6a2b037 | Edit trail and time log tables inherited the sheet's fixed layout / sticky 34 px headers: headings clipped ("Toleranc"), scan labels "RIDER-11...", list header floating. | Screenshots at 1100 and 1280. |
| 1f997a2 | At 600 px the right panel covered the brush options; header touched the edge. | Screenshot. |
| 1c0db2c | One visible focus ring on all controls; placeholder contrast raised. | Not visually checked. |
| 444d0db | Housekeeping: unused prop. | Build. |

## Found, not fixed

- Undo history keeps up to 6 full-volume copies of three layers (`pushBaseHistory`, App.jsx ~312): roughly 100-270 MB on a 236-slice scan. Store only the slice range if memory is a concern.
- Time not yet saved when switching scan: up to 2 s lost (interval save).
- Empty brush stroke still adds an undo entry (no-op undo press).
- Undo of a brush stroke does not remove its slice from the Fill-between keys.
- `status` is shared between the scan info bar and messages ("Copied N rows", errors, "No DICOM images"): a message replaces the scan info until the next load, and Match to baseline clears it.
- Quota errors in `save()` are swallowed: outlines/trail silently stop saving.
- Pasted rows with Excel-localised dates (e.g. 1/14/2025) will not match the baseline's ISO date, so lobe/type are not inherited. CSV cells starting with `=` are not escaped.
- `Clear` (all rows) and deleting an outline have no confirmation.
- Trail events logged before reload with `vol` null are stamped with the first outline's volume.

## Taste suggestions (unchanged)

- Timer and time log are hidden below 760 px; at 600 px the tool is cramped (data header wraps, Clear orphaned). It is a desktop tool; a "best at 1100 px or wider" note would do.
- Tooltips and the hint bar both repeat tool descriptions; the hint bar truncates ("drag outw...") at 1024 px.
- Wording: "Tumours" in the panel vs "Nodule" in the sheet; "Erase" vs "Brush erase".
- Modals lack `aria-modal` and focus trapping.

## Could not test

Real WebGPU-less (`?ep=wasm`) run, thick-slice and corrupt folders, localStorage quota, the clipboard denial path, the outline-worker error path, Paste baseline rows end to end, 1440 px beyond the paste modal. The browser pane was sometimes hidden, so timing-related behaviour (rAF) may differ from a visible window.

## Note

While testing I accidentally clicked the CSV button, which downloaded a one-row test file (the user saved it as `data/tumour_rows.csv`). It is test data from the review and can be deleted.

## Update: second round (small items)
Done in two further commits (dates; notices, storage warning, confirmations, empty-stroke undo, timer save): the status-line overwrite, swallowed storage errors, no confirmation on Clear and outline delete, Excel date formats in pasted rows, empty-stroke undo step, timer loss on scan switch. Verified in the browser: bad folder keeps the scan info and shows a notice, storage warning, delete confirmation. Still open: undo memory, Fill-between keys after undo, trail events with unset volume after reload, CSV formula escaping.
