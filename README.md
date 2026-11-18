# Lung Outline Tool

**Lung Outline Tool** is a prototype built for a simulated thoracic oncology research lab to cut the manual time spent finding, outlining and measuring lung tumours on CT. You click a tumour, drag to set its size, brush to fix hazy edges, and read volume and long/short axis live. A lung-segmentation model (LungMask R231 via ONNX Runtime Web) keeps outlines inside the lung. Several tumours per scan, a timer and time log, and a one-click row for the lab's sheet are included.

Scans are read in the browser and never uploaded. Research use only; not a medical device, and no clinical claims.

Data for testing: TCIA RIDER Lung CT and RIDER-LungCT-Seg (CC BY). Model: LungMask, Apache-2.0. See `NOTICE.md`.

## Using it
- **Open scan folder**, or drop a folder on the canvas. If the folder holds several series you pick one; slices thicker than 1.3 mm show a warning.
- **Outline:** click a tumour. Drag outward or inward to set the radius; the tolerance slider is in the right panel (`,` and `.` step it), and the scan's other tumours show as faint outlines. The numbers (volume, long and short axis) update live, and the axes are drawn on the slice where the outline is largest (`M` jumps there).
- **Brush and erase:** paint on the current slice, or through several slices with the depth slider. `Shift` erases while brushing; `Ctrl/Cmd+Z` undoes.
- **View:** wheel for slices, `Ctrl/Cmd+wheel` or pinch to zoom, `Space+drag` to pan, hold `H` to hide the outline. The `?` button lists every shortcut.
- **Several tumours:** `N` saves the outline and starts another. The panel at the top right lists them with volumes; click one to reopen and edit it. Outlines are saved in the browser per scan (open the same folder again to get them back). The row's nodule ID comes from the outline label.
- **Window:** `W` switches Lung and Soft; the sliders button sets level and width by hand.
- **Time:** the header timer counts active minutes on the scan (`P` pauses). Click it for the time log: per scan, finding, outline and rows, total, and the by-hand model, with a CSV download.
- **Rows:** `Enter` adds a row in the lab's 18-column order; **Copy rows** pastes into Excel, **CSV** downloads. Lobe, type, solid component, match status, nodule ID and notes are editable in the table.

## Run locally
```bash
npm install
npm run dev        # http://localhost:5173
```

## Build and deploy (free static hosting)
```bash
npm run build      # output in dist/
```
Deploy `dist/` to any static host (about 133 MB: the lung model 111 MB and the ONNX Runtime file 21 MB). Free hosts limit single files (Cloudflare Pages: 25 MiB), so the lung model is stored in 6 chunks of 20 MiB in `public/model/` and joined in the browser; the largest other file is the 20.7 MiB runtime. No special server headers are needed.

## Lung model
After a scan loads, the LungMask model (ONNX, `public/model/`) runs in a background worker and gives the outline its lung limit. Outlines work straight away without it, with lower accuracy (the status line says "without lung limit"), and are upgraded automatically when the model finishes.
- **WebGPU** (recent Chrome or Edge): about 30 s per scan.
- **No WebGPU:** falls back to single-threaded CPU, which is much slower (minutes). Multi-threaded WebAssembly is not used: initialising it inside a worker hangs.
- `?ep=wasm` or `?ep=webgpu` in the address forces one backend (for testing).

## Layout
- `src/core/`: image-processing modules (DICOM reader, lung mask, click-to-outline), plain JavaScript. Synced from the research folder with `npm run sync-core`; do not edit by hand.
- `public/model/`: LungMask R231 network (ONNX) in chunks. Rebuild with `npm run split-model -- <r231.onnx>`.
- `scripts/`: sync and model split helpers.
- `src/*.worker.js`: the outline and lung model workers.

## Data
Practice scans are public: The Cancer Imaging Archive, RIDER Lung CT and RIDER-LungCT-Seg. No scans are stored in this repository; load a DICOM folder from disk.

See `NOTICE.md` for credits and licences.

## Follow-up matching
With a follow-up scan open, **Match to baseline** (header) asks for the baseline scan's folder (it needs the outline you saved there in this browser), runs the lung model on it, and proposes where the same tumour is on the open scan (lung registration, then a local image match). The proposal appears as a new tumour, flagged **Confident** or **Uncertain** in the panel and in the row's Match status; check the location and fix it with the drag or brush. On same-day test-retest pairs the seed hit the expert outline 28 of 28 times (see `notes/opus_match_report.md`); months-apart scans are untested.

**Paste baseline rows:** the sheet header has a "Paste baseline rows" button. Paste rows copied from your sheet (tab- or comma-separated, header optional); they show greyed in the table, are used for matching (the follow-up takes Nodule ID, Lobe and Type from the baseline row of the same patient, scan date and nodule, and the timepoint moves to the next Follow-up), and are not included in Copy rows or CSV.

## Deploy (GitHub Pages)
Push to a GitHub repository whose default branch is `main`, then in Settings > Pages choose "GitHub Actions". `.github/workflows/pages.yml` builds with `BASE=/<repo>/` and publishes `dist`. The site is static: scans are read in the browser and never uploaded. Locally, `npm run build` uses base `/`.
