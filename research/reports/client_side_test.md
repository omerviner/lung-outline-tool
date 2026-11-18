# Can LungMask run in the browser? (feasibility test, 17 Nov 2026)

Model: LungMask R231, a 2D U-Net (1 x 256 x 256 slice in, 3 classes out), Apache-2.0. Exported to ONNX (116 MB), run with ONNX Runtime Web 1.20.1 in the app's built-in browser on an Apple M3 (8 cores).

| Check | Result |
|---|---|
| ONNX export vs PyTorch | max abs diff 2.6e-5, identical class on 100% of pixels |
| Browser vs PyTorch on 16 real CT slices | identical class on 100.000% of pixels (WebAssembly and WebGPU) |
| WebAssembly, 1 thread (page not cross-origin isolated) | about 2,045 ms per slice, about 8 min for a 236-slice scan |
| WebAssembly, 8 threads (needs COOP/COEP headers) | about 630 ms per slice, about 2.5 min per scan |
| WebGPU | about 124 ms per slice, about 30 s per scan |

## Port to JavaScript (longmarker-tool/core/)
- Slice preprocessing and post-processing (body crop, resize, largest component, hole filling) and the blob stage (3D opening, distance transform, watershed, ranking) are ported to plain JavaScript that runs in Node and the browser.
- Lung mask: JS matches the Python LungMask output with Dice 1.0000 on 4 scans (about 50-70 voxels differ out of millions).
- Blob stage, replayed on all 59 scans with the same lung masks: 32 of 59 expert tumours found, same hit or miss as Python on 59 of 59 scans, same candidate count on 59 of 59, same median Dice (0.77).
- Bug found on the way: a peak-detection helper overwrote its input array, which gave 15 of 59 until fixed.

Not yet done: running the full JS pipeline (lung mask plus blobs) in the browser on a real scan end to end. Network timings are from one machine and one scan.

Files: longmarker-tool/client-experiment/ (export_onnx.py, dump_slices.py, index.html, serve_isolated.py).
