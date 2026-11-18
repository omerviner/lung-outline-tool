#!/bin/bash
# Copy the image-processing modules the app needs from the research folder (../core/src) into src/core.
# Run before committing so the deployed repo is self-contained.
set -e
cd "$(dirname "$0")/.."
SRC=../core/src
for f in dicom.js morph.js blobs.js lungmask.js clickoutline.js match.js interp.js; do cp "$SRC/$f" "src/core/$f"; done
echo "synced: $(ls src/core | tr '\n' ' ')"
