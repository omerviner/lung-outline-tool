// DICOM CT series reader (uncompressed, 16-bit). Works in Node and in the browser.
import dicomParser from 'dicom-parser';

function num(ds, tag, idx = 0) {
  const s = ds.string(tag, idx);
  return s === undefined ? NaN : parseFloat(s);
}

/** Parse one slice. `bytes` is a Uint8Array of a DICOM file. */
export function parseSlice(bytes) {
  const ds = dicomParser.parseDicom(bytes);
  const rows = ds.uint16('x00280010');
  const cols = ds.uint16('x00280011');
  const signed = ds.uint16('x00280103') === 1;
  const el = ds.elements.x7fe00010;
  if (!el) throw new Error('no pixel data');
  // copy to an aligned buffer, then view as 16-bit
  const raw = new Uint8Array(el.length);
  raw.set(bytes.subarray(el.dataOffset, el.dataOffset + el.length));
  const px = signed ? new Int16Array(raw.buffer) : new Uint16Array(raw.buffer);
  const ipp = [0, 1, 2].map((i) => num(ds, 'x00200032', i));
  return {
    rows, cols, px, signed,
    z: ipp[2], x0: ipp[0], y0: ipp[1],
    dy: num(ds, 'x00280030', 0), dx: num(ds, 'x00280030', 1),
    slope: num(ds, 'x00281053') || 1, intercept: num(ds, 'x00281052') || 0,
    patientId: ds.string('x00100020'), thickness: num(ds, 'x00180050'),
    seriesNumber: num(ds, 'x00200011'), studyDate: ds.string('x00080020'),
  };
}

/** Build a HU volume (Int16, z-major) from many slice files, sorted by z position. */
export function buildVolume(files) {
  const slices = files.map(parseSlice).sort((a, b) => a.z - b.z);
  const { rows, cols } = slices[0];
  const vol = new Int16Array(slices.length * rows * cols);
  slices.forEach((s, k) => {
    const o = k * rows * cols;
    for (let i = 0; i < rows * cols; i++) vol[o + i] = s.px[i] * s.slope + s.intercept;
  });
  const zs = slices.map((s) => s.z);
  const dz = zs.length > 1 ? (zs[zs.length - 1] - zs[0]) / (zs.length - 1) : slices[0].thickness;
  return {
    vol, dims: [slices.length, rows, cols], spacing: [dz, slices[0].dy, slices[0].dx],
    origin: [slices[0].x0, slices[0].y0], zs,
    meta: { patientId: slices[0].patientId, seriesNumber: slices[0].seriesNumber, studyDate: slices[0].studyDate },
  };
}
