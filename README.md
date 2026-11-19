# Lung Outline Tool

Click a tumour on a lung CT and get an editable 3D outline with live volume and diameters, plus a row for the lab's Excel sheet. Everything runs in the browser, so scans never leave the machine.

**Live:** https://omerviner.github.io/lung-outline-tool/ (Chrome or Edge recommended)

Built as a prototype for a simulated thoracic oncology research lab, to cut the manual time spent outlining and measuring lung tumours. **Research use only. Not a medical device; no clinical claims.**

- **Results:** [docs/RESULTS.md](docs/RESULTS.md): what works, what fails, and how the time saved is measured (modelled, plus the lab contact's stated runs; not stopwatch measurements).
- **Method, scores and scripts:** [research/](research/README.md).

## What it does
- **Click-to-outline:** click a tumour; the outline, volume (mm³) and long, short and mean diameter appear at once. Drag outward or inward to resize; a tolerance slider handles hazy edges.
- **Brush and eraser:** fix edges on one slice or through several; **Fill between** interpolates the slices between the ones you edited.
- **Several tumours per scan,** saved in the browser, with the others shown faintly.
- **Sheet row:** one row per tumour in the lab's 18 columns and wording; copy into Excel or download CSV.
- **Follow-up matching:** propose the tumour on a later scan from a baseline, with Paste baseline rows to carry over nodule ID, lobe and type.
- **Edit trail and time log:** every correction with the volume after it, and active minutes per scan, both exportable.
- **Lung model in the browser** (LungMask R231 via ONNX Runtime Web) keeps outlines inside the lung.

## Quick start
1. Open the live link, or run locally (below).
2. Click **Open scan folder** and choose a folder of DICOM files for one CT scan. Nothing is uploaded.
3. Click a tumour. Press **Enter** to add its row.

Practice scans are public: TCIA "RIDER Lung CT" (doi 10.7937/k9/tcia.2015.u1x8a5nr) and the expert outlines "RIDER-LungCT-Seg" (doi 10.7937/tcia.2020.jit9grk8), downloaded with the TCIA Data Retriever (CC BY, attribute). No scans are stored in this repository.

## Using it
- **Scan:** if the folder holds several series you pick one; slices thicker than 1.3 mm show a warning. Wheel or arrow keys change slice; `Ctrl/Cmd+wheel` or pinch zooms; `Space+drag` pans; hold `H` to hide the outline; `W` switches Lung and Soft window, and the sliders button sets level and width. The `?` button lists every shortcut.
- **Outline:** click a tumour, drag to set the radius. The tolerance slider is in the right panel (`,` and `.` step it). Axes are drawn on the slice where the outline is largest (`M` jumps there).
- **Brush and erase:** paint on the current slice, or through several with the depth slider; `[` `]` change brush size; `Shift` erases while brushing; `Ctrl/Cmd+Z` undoes. **Fill between** (`F`): fix a few slices, then fill the slices between the first and last edited one by shape interpolation. It replaces what is between, so edit the slices where the shape changes; Undo reverts it.
- **Several tumours:** `N` saves the outline and starts another; the right panel lists them with volumes; click one to reopen it. The row's nodule ID comes from the outline label.
- **Rows:** `Enter` adds a row; **Copy rows** pastes into Excel (tab-separated), **CSV** downloads. Lobe, type, solid component, match status, nodule ID and notes are editable in the table. Volume is in mm³, dates YYYY-MM-DD, slice numbers from 1.
- **Time:** the header timer counts active minutes on the scan (`P` pauses). Click it for the time log (finding, outline and rows, total, and the by-hand model), with CSV download.

### Edit trail
The list button in the header opens the trail of the open scan: every click, drag resize, tolerance change, brush add or erase, undo, clear, match proposal, saved image and row, in order, with the active time and the volume after each step. A summary per tumour shows the counts and how a matched proposal was handled (accepted as proposed, or edited). Add a note to label an edge case; the camera button saves the slice with its outline as a PNG. Kept in the browser per scan; exports to CSV.

### Follow-up matching
With a follow-up scan open, **Match to baseline** (header) asks for the baseline scan's folder (it needs the outline you saved there in this browser), runs the lung model on it, and proposes where the same tumour is on the open scan (lung registration, then a local image match). The proposal appears as a new tumour flagged **Confident** or **Uncertain**, also in the row's Match status; check the place and fix it with the drag or brush. On same-day test-retest pairs the proposed point hit the expert outline 28 of 28 times (see [research/reports/opus_match_report.md](research/reports/opus_match_report.md)); months-apart scans are untested.

**Paste baseline rows** (sheet header): paste rows copied from your sheet (tab- or comma-separated, header optional). They show greyed, are used for matching (the follow-up takes nodule ID, lobe and type from the baseline row of the same patient, scan date and nodule, and the timepoint moves to the next Follow-up), and are not included in Copy rows or CSV.

## Run locally
Needs Node 18 or newer.
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```

## Deploy
The site is static (scans are read in the browser). For GitHub Pages: push to a repository whose default branch is `main` and set Settings > Pages > "GitHub Actions"; `.github/workflows/pages.yml` builds with `BASE=/<repo>/` and publishes `dist`. Any other static host works too: deploy `dist/` (about 133 MB: the lung model 111 MB and the ONNX Runtime file 21 MB). Free hosts limit single files (Cloudflare Pages: 25 MiB), so the model is stored in 6 chunks of 20 MiB in `public/model/` and joined in the browser. No special server headers are needed.

## Lung model
After a scan loads, the LungMask model (ONNX, `public/model/`) runs in a background worker and gives the outline its lung limit. Outlines work straight away without it, with lower accuracy (the status says "without lung limit"), and are upgraded automatically when it finishes.
- **WebGPU** (recent Chrome or Edge): about 30 s per scan.
- **No WebGPU:** single-threaded CPU on every third slice, about 3 minutes per 236-slice scan (twice when matching to a baseline). Multi-threaded WebAssembly is not used: initialising it inside a worker hangs.
- `?ep=wasm` or `?ep=webgpu` in the address forces one backend (for testing).

## Repository layout
- `src/`: the React app. `src/core/`: image-processing modules (DICOM reader, lung mask, click-to-outline, matching, interpolation), plain JavaScript, synced from the research folder with `npm run sync-core`; do not edit by hand. `src/*.worker.js`: the outline, lung model and matching workers.
- `public/model/`: the LungMask R231 network (ONNX) in chunks. Rebuild with `npm run split-model -- <r231.onnx>`.
- `docs/`: the results write-up and example screenshots. `research/`: reports, result tables and scoring scripts (they need the TCIA data, which is not included).
- `scripts/`: sync and model split helpers.

## Credits and licences
LungMask R231 (Hofmanninger et al., Apache-2.0); TCIA RIDER Lung CT and RIDER-LungCT-Seg (CC BY, attribute); Inter font (OFL); React, ONNX Runtime Web, dicom-parser and Vite (MIT). See [NOTICE.md](NOTICE.md).
