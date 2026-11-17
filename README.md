# Lung outline tool

Research use only. Not for clinical use; no clinical claims.

A browser tool for lung CT: click a tumour to get an editable 3D outline, with volume and diameters updating as you edit, and a row to paste into a spreadsheet. Everything runs in the browser, so scans never leave the machine. Built for a (simulated) thoracic oncology research lab as a take-home project.

## Run locally
```bash
npm install
npm run dev        # http://localhost:5173
```

## Build and deploy (free static hosting)
```bash
npm run build      # output in dist/
```
Deploy `dist/` to any static host. `public/_headers` sets the cross-origin isolation headers that let WebAssembly use several threads (Cloudflare Pages and Netlify read this file). WebGPU does not need them. Free hosts limit single files (Cloudflare Pages: 25 MiB), so the lung model is stored in 6 chunks in `public/model/` and joined in the browser.

## Layout
- `src/core/`: image-processing modules (DICOM reader, lung mask, click-to-outline), plain JavaScript. Synced from the research folder with `npm run sync-core`; do not edit by hand.
- `public/model/`: LungMask R231 network (ONNX) in chunks. Rebuild with `npm run split-model -- <r231.onnx>`.
- `scripts/`: sync and split helpers.

## Data
Practice scans are public: The Cancer Imaging Archive, RIDER Lung CT and RIDER-LungCT-Seg. No scans are stored in this repository; load a DICOM folder from disk.

See `NOTICE.md` for credits and licences.
