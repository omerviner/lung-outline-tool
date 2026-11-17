import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Viewer from './Viewer.jsx';
import { Icon } from './icons.jsx';
import OutlineWorker from './outline.worker.js?worker';
import LungWorker from './lungmask.worker.js?worker';
import { parseSlice, buildVolume } from './core/dicom.js';
import { downsample } from './core/blobs.js';
import { measure, axesOnSlice } from './measure.js';
import { COLUMNS, COLUMN_META, MATCH_OPTIONS, makeRow, toTSV, toCSV, groupSpans, splitLabel } from './sheet.js';

const ROW_H = 34;            // table body row height
const STRIP_BASE = 106 + 15; // first guess of the strip's fixed height (header bar, table head, scrollbar); measured once the table exists
const GROUPS = groupSpans();
const TABLE_W = 36 + COLUMNS.reduce((n, [k]) => n + COLUMN_META[k].w, 0) + 44;

const WINDOWS = { Lung: { level: -600, width: 1500 }, Soft: { level: 40, width: 400 } };
const TOOLS = [
  { id: 'outline', icon: 'target', label: 'Outline', key: 'O', tip: 'Click a tumour to outline it. Drag outward or inward to set the radius.', hint: 'Click the tumour, then drag outward to enlarge it' },
  { id: 'add', icon: 'brush', label: 'Brush', key: 'B', tip: 'Paint area into the outline on this slice. Hold Shift to erase.', hint: 'Paint to add to the outline. Hold Shift to erase' },
  { id: 'erase', icon: 'eraser', label: 'Erase', key: 'E', tip: 'Remove area from the outline on this slice.', hint: 'Paint to remove from the outline' },
];
// time model from Daniel's estimates (notes/time_saved_tracker.md): minutes by hand for a scan with n tumours
const MODEL = { findMin: 15, perTumourMin: 11 }; // finding 10-20 per scan; per tumour axes 3 + typing 4 + 1 in 5 full outlines x 20
const modelMinutes = (n) => MODEL.findMin + MODEL.perTumourMin * n;
const fmt1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

/** Binary mask over slices z0..z1 as alternating run lengths (starting with zeros): small enough for localStorage. */
function rleEncode(mask, z0, z1, sl) {
  const runs = []; let cur = 0, n = 0;
  for (let i = z0 * sl, e = (z1 + 1) * sl; i < e; i++) {
    if (mask[i] === cur) n++; else { runs.push(n); cur = mask[i]; n = 1; }
  }
  runs.push(n);
  return runs;
}
function rleDecode(runs, z0, total, sl) {
  const out = new Uint8Array(total); let i = z0 * sl, v = 0;
  for (const n of runs) { if (v) out.fill(1, i, i + n); i += n; v ^= 1; }
  return out;
}
const rleVoxels = (runs) => runs.reduce((s, n, k) => s + (k % 2 ? n : 0), 0);
const store = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

const SHORTCUTS = [ // [group, [[keys, what it does], ...]]; every key is its own chip
  ['Tools', [[['O', 'B', 'E'], 'Outline, brush, erase'], [['[', ']'], 'Brush size'], [['{', '}'], 'Brush depth (slices)'], [['Shift'], 'Hold to erase with the brush']]],
  ['Edit', [[['Ctrl/Cmd+Z'], 'Undo'], [['Del'], 'Clear the outline'], [['Enter'], 'Add a row'], [['N'], 'Start another tumour']]],
  ['View', [[['W'], 'Lung or soft window'], [['P'], 'Pause or resume the timer'], [['H'], 'Hold to hide the outline'], [['M'], 'Go to the measured slice'], [['+', '-', '0'], 'Zoom in, out, fit'], [['Ctrl/Cmd+scroll'], 'Zoom (or pinch)'], [['Space+drag'], 'Pan']]],
  ['Slices', [[['scroll'], 'Change slice'], [['↑', '↓'], 'Change slice']]],
];

function Tip({ title, keys, text, down = false }) {
  return (
    <div className={`tip ${down ? 'down' : ''}`} role="tooltip">
      <div className="tiptitle"><b>{title}</b>{keys && <kbd>{keys}</kbd>}</div>
      <div>{text}</div>
    </div>
  );
}

/** One button: open the folder that holds the DICOM files. In the dialog the files look greyed out; the folder itself is selected. */
function FolderPicker({ onFiles, primary = false, label = 'Open scan folder' }) {
  const pick = (e) => { onFiles(e.target.files); e.target.value = ''; }; // reset so the same folder can be chosen again
  return (
    <label className={`btn ${primary ? 'primary' : ''}`} title="Choose the folder with the scan's DICOM files">
      <Icon name="folder" size={15} /> {label}
      <input type="file" webkitdirectory="true" directory="true" multiple onChange={pick} />
    </label>
  );
}

/** Progress of the lung model, which runs in the background after a scan is loaded. */
function LungChip({ s }) {
  if (s.phase === 'idle') return null;
  const pct = s.total ? Math.round((100 * s.done) / s.total) : 0;
  const text = s.phase === 'loading' || s.phase === 'running' ? `Lung model ${pct}%`
    : s.phase === 'preparing' ? 'Preparing lung model'
    : s.phase === 'ready' ? 'Lung limit on'
    : 'Lung model failed';
  const title = s.phase === 'error' ? s.message
    : s.phase === 'ready' ? `The lung model keeps outlines inside the lung. Ready in ${Math.round(s.ms / 1000)} s (${s.backend === 'webgpu' ? 'WebGPU' : 'CPU'}).`
    : 'The lung model keeps outlines inside the lung. Outlines work without it, with lower accuracy.';
  return (
    <span className={`lungchip ${s.phase}`} title={title}>
      {(s.phase === 'loading' || s.phase === 'running') && <i className="bar"><i style={{ width: `${pct}%` }} /></i>}
      {text}
    </span>
  );
}

/** Time log: measured active minutes per scan next to the by-hand model (modelled from Daniel's estimates). */
function TimePanel({ log, nowKey, liveMin, onClear }) {
  const list = Object.entries(log).map(([key, e]) => {
    const total = key === nowKey ? liveMin : e.ms / 60000, n = e.rows.length;
    const find = e.first == null ? null : Math.min(total, e.first / 60000);
    const hand = n ? modelMinutes(n) : null;
    return { key, label: e.label, n, find, work: find == null ? null : total - find, total, hand, saved: hand == null ? null : hand - total, updated: e.updated };
  }).sort((a, b) => b.updated - a.updated);
  const done = list.filter((r) => r.hand != null);
  const sumHand = done.reduce((s, r) => s + r.hand, 0), sumTool = done.reduce((s, r) => s + r.total, 0);
  const dash = (v) => (v == null ? '–' : fmt1(v));
  const csv = () => {
    const head = 'Scan,Tumours,Finding (min),Outline and rows (min),Total with tool (min),By hand, modelled (min),Saved (min)';
    const body = list.map((r) => [`"${r.label}"`, r.n, dash(r.find), dash(r.work), fmt1(r.total), dash(r.hand), dash(r.saved)].join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[head, ...body].join('\n')], { type: 'text/csv' })); a.download = 'time_log.csv'; a.click();
  };
  return (
    <div className="help timepanel" role="dialog" aria-label="Time log">
      <b>Time log</b>
      <p className="tnote">Active minutes on each scan (the timer stops when paused), from loading to the last row. "By hand" is a model from Daniel's estimates: {MODEL.findMin} min to find, plus {MODEL.perTumourMin} min per tumour. It is not a stopwatch measurement.</p>
      {list.length ? (
        <table className="ttable">
          <thead><tr><th>Scan</th><th>Tumours</th><th>Finding</th><th>Outline + rows</th><th>With tool</th><th>By hand</th><th>Saved</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.key} className={r.key === nowKey ? 'now' : ''}>
                <td title={r.label}>{r.label}</td><td>{r.n}</td><td>{dash(r.find)}</td><td>{dash(r.work)}</td><td>{fmt1(r.total)}</td><td>{dash(r.hand)}</td><td>{dash(r.saved)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="tnote">No scans yet.</p>}
      {done.length > 0 && <p className="tsum">{done.length} scan{done.length > 1 ? 's' : ''} with rows: {fmt1(sumTool)} min with the tool vs {fmt1(sumHand)} min by hand ({Math.round((100 * (sumHand - sumTool)) / sumHand)}% less, modelled).</p>}
      <div className="modalbtns"><button className="btn" disabled={!list.length} onClick={csv}>Download CSV</button><button className="btn ghost" disabled={!list.length} onClick={onClear}>Clear log</button></div>
    </div>
  );
}

/** Letters for the four image edges from the scan's orientation (DICOM LPS): null when the slices are oblique. */
function orientationLabels(iop) {
  if (!iop || iop.length < 6) return null;
  const rx = iop[0], cy = iop[4];
  if (Math.abs(rx) < 0.9 || Math.abs(cy) < 0.9) return null;
  return { left: rx > 0 ? 'R' : 'L', right: rx > 0 ? 'L' : 'R', top: cy > 0 ? 'A' : 'P', bottom: cy > 0 ? 'P' : 'A' };
}

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6aa6aa" /><stop offset="1" stopColor="#2c5e63" /></linearGradient></defs>
      <rect width="32" height="32" rx="9" fill="url(#lg)" />
      <rect x="15.1" y="5.5" width="1.8" height="9" rx=".9" fill="#fff" />
      <path d="M16 13.4l-2.4 2.6M16 13.4l2.4 2.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M14 12.2C10.6 12.5 7 16.3 6.6 21.7c-.1 1.9 1.3 3.1 3 2.8 2.4-.5 4.4-2.4 4.4-4.9z" fill="#fff" />
      <path d="M18 12.2c3.4.3 7 4.1 7.4 9.5.1 1.9-1.3 3.1-3 2.8-2.4-.5-4.4-2.4-4.4-4.9z" fill="#fff" />
    </svg>
  );
}

/** Collect files from a dropped folder (reads directory entries recursively). */
async function filesFromDrop(items) {
  const entries = Array.from(items).map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean); // before any await
  const out = [];
  const walk = async (e) => {
    if (e.isFile) out.push(await new Promise((r) => e.file(r)));
    else if (e.isDirectory) {
      const rd = e.createReader();
      for (;;) {
        const batch = await new Promise((r) => rd.readEntries(r));
        if (!batch.length) break;
        for (const c of batch) await walk(c);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

export default function App() {
  const [series, setSeries] = useState(null);
  const [status, setStatus] = useState('');
  const [slice, setSliceRaw] = useState(0);
  const [win, setWin] = useState('Lung');
  const [tool, setTool] = useState('outline');
  const [tol, setTol] = useState(0.5); // v2's evaluated default
  const [brushMm, setBrushMm] = useState(4);
  const [brushDepth, setBrushDepth] = useState(1); // slices painted at once (odd numbers)
  const [chooser, setChooser] = useState(null);
  const [warn, setWarn] = useState('');
  const [version, setVersion] = useState(0);
  const [info, setInfo] = useState('');
  const [computing, setComputing] = useState(false);
  const [over, setOver] = useState(false);
  const [rows, setRows] = useState(() => store('rows', []));
  const [initials, setInitials] = useState(() => store('initials', ''));
  const [timepoint, setTimepoint] = useState(() => store('timepoint', 'T0'));
  const [includeVolume, setIncludeVolume] = useState(true);
  const [minutes, setMinutes] = useState(0);
  const [paused, setPaused] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [timeLog, setTimeLog] = useState(() => store('timelog', {}));
  const [wl, setWl] = useState(null); // manual window {level, width}; null = the Lung or Soft preset
  const [wlOpen, setWlOpen] = useState(false);
  const [olView, setOlView] = useState([]); // outlines of this scan: [{ id, label, vol }]
  const [activeId, setActiveId] = useState(null);
  const [flash, setFlash] = useState(-1);
  const [zoom, setZoom] = useState(1);
  const [gesture, setGesture] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lungState, setLungState] = useState({ phase: 'idle' });
  const [hidePinned, setHidePinned] = useState(false);
  const [holdHide, setHoldHide] = useState(false);
  const viewerRef = useRef(null);
  const [dataH, setDataH] = useState(() => store('dataH', STRIP_BASE + 4 * ROW_H));
  const tableRef = useRef(null), chromeRef = useRef(STRIP_BASE); // chrome = strip height minus the visible body rows

  // The outline is three layers: `base` from the click (recomputed when tolerance or radius change),
  // plus the user's brush `add` and `erase`. `mask` is the combined result that is shown and measured.
  const L = useRef({ base: null, add: null, erase: null, mask: null, zr: null, baseZr: null, addZr: null, edited: false });
  const seriesRef = useRef(null), workerRef = useRef(null), inflight = useRef(false), queued = useRef(null), reqId = useRef(0);
  const last = useRef(null), hist = useRef([]), stroke = useRef(null), raf = useRef(0);
  const autoR = useRef(0), exactTimer = useRef(0), pendingExact = useRef(false);
  const lungWorkerRef = useRef(null), lungId = useRef(0), requestRef = useRef(null);
  const depthRef = useRef(1);
  // several outlines per scan: `items` hold the saved ones (run-length coded); the active one lives in `L`
  const ol = useRef({ items: [], active: null, next: 1, key: '' });
  // active time on the scan: runs only while not paused; saved so a reload does not lose it
  const clock = useRef({ ms: 0, since: 0, first: null, rows: [] });
  const tolRef = useRef(tol), tolSession = useRef(false), tolTimer = useRef(0);
  tolRef.current = tol;
  depthRef.current = brushDepth;

  useEffect(() => save('rows', rows), [rows]);
  useEffect(() => { save('initials', initials); save('timepoint', timepoint); }, [initials, timepoint]);
  // ---- active time (pausable) ----
  const elapsedMs = () => clock.current.ms + (clock.current.since ? Date.now() - clock.current.since : 0);
  const saveTime = useCallback(() => {
    const k = ol.current.key;
    if (!k) return;
    const c = clock.current, ms = c.ms + (c.since ? Date.now() - c.since : 0);
    setTimeLog((prev) => { const next = { ...prev, [k]: { label: ol.current.label, ms, first: c.first, rows: c.rows, updated: Date.now() } }; save('timelog', next); return next; });
  }, []);
  const togglePause = useCallback(() => {
    const c = clock.current;
    if (!ol.current.key) return;
    if (c.since) { c.ms += Date.now() - c.since; c.since = 0; setPaused(true); } else { c.since = Date.now(); setPaused(false); }
    setMinutes(elapsedMs() / 60000); saveTime();
  }, [saveTime]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => { if (!ol.current.key) return; setMinutes(elapsedMs() / 60000); if (clock.current.since) saveTime(); }, 2000);
    return () => clearInterval(t);
  }, [saveTime]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const el = tableRef.current; if (el && rows.length) el.scrollTop = el.scrollHeight; }, [rows.length]);

  useEffect(() => save('dataH', dataH), [dataH]);
  // keep the strip at a whole number of rows, so the last visible row is never cut off
  useLayoutEffect(() => {
    const el = tableRef.current, thead = el && el.querySelector('thead');
    if (!el || !thead) return;
    const body = el.clientHeight - thead.offsetHeight; // room for rows at this height (scrollbar included, whatever it is)
    chromeRef.current = dataH - body;
    const rem = body % ROW_H;
    if (rem > 1) setDataH((h) => Math.max(chromeRef.current + ROW_H, h - rem));
  }, [dataH, rows.length]);
  useEffect(() => {
    const onResize = () => setDataH((h) => h + 0.001); // re-run the snap after a window resize
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const drag = useRef(null);
  const onSplitDown = (e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y: e.clientY, h: dataH }; };
  const onSplitMove = (e) => { if (drag.current) setDataH(Math.max(chromeRef.current + ROW_H, Math.min(window.innerHeight * 0.55, drag.current.h + drag.current.y - e.clientY))); };
  const onSplitUp = () => { drag.current = null; };
  const fitAllRows = () => setDataH(Math.min(window.innerHeight * 0.55, chromeRef.current + Math.max(rows.length, 4) * ROW_H));

  const bump = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; setVersion((n) => n + 1); });
  }, []);

  const nz = series ? series.dims[0] : 0;
  const setSlice = useCallback((f) => setSliceRaw((s) => Math.max(0, Math.min(nz - 1, typeof f === 'function' ? f(s) : f))), [nz]);

  const recomposite = (zs) => { // zs: [first, last] slice range to update; default = everything
    const { base, add, erase, mask } = L.current, sl = seriesRef.current ? seriesRef.current.gd[1] * seriesRef.current.gd[2] : 0;
    const from = zs && sl ? zs[0] * sl : 0, to = zs && sl ? (zs[1] + 1) * sl : mask.length;
    for (let i = from; i < to; i++) mask[i] = (base[i] && !erase[i]) || add[i] ? 1 : 0;
  };
  const unionZ = (zr, z0, z1) => (zr ? [Math.min(zr[0], z0), Math.max(zr[1], z1)] : [z0, z1]);
  const joinZ = (a, b) => (a && b ? [Math.min(a[0], b[0]), Math.max(a[1], b[1])] : a || b);

  // ---- history (undo) ----
  const pushBaseHistory = () => {
    const l = L.current;
    if (!l.base) return;
    hist.current.push({ type: 'base', base: l.base.slice(), add: l.edited ? l.add.slice() : null, erase: l.edited ? l.erase.slice() : null, last: last.current, baseZr: l.baseZr, addZr: l.addZr });
    if (hist.current.length > 6) hist.current.shift();
  };
  const undo = useCallback(() => {
    const e = hist.current.pop();
    const l = L.current;
    if (!e) return;
    if (e.type === 'brush') {
      for (let k = e.idx.length - 1; k >= 0; k--) { l.add[e.idx[k]] = e.a[k]; l.erase[e.idx[k]] = e.e[k]; l.mask[e.idx[k]] = (l.base[e.idx[k]] && !e.e[k]) || e.a[k] ? 1 : 0; }
    } else {
      l.base = e.base; l.add = e.add || new Uint8Array(e.base.length); l.erase = e.erase || new Uint8Array(e.base.length);
      l.edited = !!e.add; l.baseZr = e.baseZr; l.addZr = e.addZr; l.zr = joinZ(l.baseZr, l.addZr); last.current = e.last; recomposite();
    }
    setInfo('Undid the last change.'); bump();
  }, [bump]);

  const clearAll = () => {
    const l = L.current;
    if (!l.base) return;
    pushBaseHistory();
    l.base.fill(0); l.add.fill(0); l.erase.fill(0); l.mask.fill(0); l.zr = l.baseZr = l.addZr = null; l.edited = false; last.current = null;
    setInfo(''); bump();
  };

  // ---- several outlines per scan ----
  const minId = useRef(0);
  const resetPending = () => { clearTimeout(exactTimer.current); pendingExact.current = false; queued.current = null; minId.current = reqId.current + 1; setComputing(false); };
  const olSync = () => { const o = ol.current; setOlView(o.items.map((it) => ({ id: it.id, label: it.label, vol: it.vol }))); setActiveId(o.active); };
  const olPersist = () => { const o = ol.current; if (o.key) save(`outlines:${o.key}`, { next: o.next, items: o.items.map(({ id, label, zr, rle }) => ({ id, label, zr, rle })) }); };
  const snapshot = () => { // copy the live outline into its saved entry
    const o = ol.current, s = seriesRef.current, l = L.current, it = o.items.find((x) => x.id === o.active);
    if (!it || !s || !l.mask) return;
    const sl = s.gd[1] * s.gd[2];
    if (l.zr) { it.rle = rleEncode(l.mask, l.zr[0], l.zr[1], sl); it.zr = l.zr.slice(); it.vol = (rleVoxels(it.rle) * s.spDS[0] * s.spDS[1] * s.spDS[2]) / 1000; }
    if (!l.zr || !it.vol) { it.rle = null; it.zr = null; it.vol = 0; }
  };
  const loadEntry = (it) => { // make a saved outline the live one: its shape becomes the base layer, brush layers start empty
    const s = seriesRef.current, l = L.current, n = l.mask.length, sl = s.gd[1] * s.gd[2];
    if (it.rle && it.zr) { l.base = rleDecode(it.rle, it.zr[0], n, sl); l.mask = l.base.slice(); l.zr = l.baseZr = it.zr.slice(); }
    else { l.base = new Uint8Array(n); l.mask = new Uint8Array(n); l.zr = l.baseZr = null; }
    l.add = new Uint8Array(n); l.erase = new Uint8Array(n); l.addZr = null; l.edited = false;
    hist.current = []; last.current = null; autoR.current = 0;
  };
  const switchTo = (id) => {
    const o = ol.current, it = o.items.find((x) => x.id === id);
    if (!it || id === o.active) return;
    snapshot(); o.active = id; resetPending(); loadEntry(it); olPersist(); olSync(); setInfo(''); bump();
  };
  const newOutline = () => {
    const o = ol.current;
    if (!seriesRef.current) return;
    snapshot();
    let n = 1; while (o.items.some((x) => x.label === `N${n}`)) n++;
    const it = { id: o.next++, label: `N${n}`, zr: null, rle: null, vol: 0 };
    o.items.push(it); o.active = it.id; resetPending(); loadEntry(it); olPersist(); olSync(); setInfo('New tumour: click it to outline.'); setTool('outline'); bump();
  };
  const removeOutline = (id) => {
    const o = ol.current;
    o.items = o.items.filter((x) => x.id !== id);
    if (id === o.active) {
      if (!o.items.length) { o.items.push({ id: o.next++, label: 'N1', zr: null, rle: null, vol: 0 }); }
      o.active = o.items[0].id; resetPending(); loadEntry(o.items[0]); setInfo(''); bump();
    }
    olPersist(); olSync();
  };
  useEffect(() => { // save the live outline shortly after it stops changing
    if (!series || !ol.current.active) return undefined;
    const t = setTimeout(() => { snapshot(); olPersist(); olSync(); }, 700);
    return () => clearTimeout(t);
  }, [version, series]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- worker ----
  const post = useCallback((q) => {
    inflight.current = true; setComputing(true);
    workerRef.current.postMessage({ type: 'outline', id: ++reqId.current, seed: q.seed, opts: q.opts });
  }, []);

  useEffect(() => {
    const w = new OutlineWorker();
    workerRef.current = w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type !== 'result') return;
      inflight.current = false;
      if (m.id < minId.current) { if (!queued.current) setComputing(false); return; } // result for an outline that was closed
      const l = L.current;
      if (l.mask) {
        const prevZr = l.baseZr; // slices that held the previous outline must be cleared too
        l.base = new Uint8Array(m.mask.buffer ? m.mask.buffer : m.mask);
        l.baseZr = m.voxels ? m.zr : null;
        l.zr = joinZ(l.baseZr, l.addZr);
        autoR.current = m.radiusMm;
        recomposite(joinZ(joinZ(prevZr, l.baseZr), l.addZr));
        setInfo(m.voxels ? `Outline in ${m.ms} ms · radius ${m.radiusMm.toFixed(0)} mm${m.usedLung ? '' : ' · without lung limit'}` : 'No outline here: click on the tumour tissue, not on air.');
        bump();
      }
      if (queued.current) { const q = queued.current; queued.current = null; post(q); } else setComputing(false);
    };
    return () => { w.terminate(); if (lungWorkerRef.current) lungWorkerRef.current.terminate(); };
  }, [bump, post]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quick preview while dragging or sliding (reads a smaller region: several updates a second), then the exact
  // outline once the movement stops. The first click is always exact.
  const requestOutline = useCallback((p, tolOverride, preview = false) => {
    const s = seriesRef.current;
    if (!s) return;
    last.current = p;
    const seed = [p.z, Math.min(s.gd[1] - 1, Math.floor(p.y / 2)), Math.min(s.gd[2] - 1, Math.floor(p.x / 2))];
    const dragged = p.distMm >= 3 ? Math.min(100, Math.max(6, p.distMm)) : undefined; // a plain click uses the automatic radius
    const opts = { t: tolOverride ?? tolRef.current };
    if (preview && (dragged || autoR.current)) { opts.radiusMm = dragged || autoR.current; opts.maxRadiusMm = 0; } // region = radius + 20 mm
    else if (dragged) opts.radiusMm = dragged;
    const q = { seed, opts };
    if (inflight.current) queued.current = q; else post(q); // latest request wins
    clearTimeout(exactTimer.current);
    pendingExact.current = preview;
    if (preview) exactTimer.current = setTimeout(() => { pendingExact.current = false; requestRef.current(last.current, undefined, false); }, 260);
  }, [post]);
  requestRef.current = requestOutline;

  const onOutline = useCallback((p) => {
    if (p.start) { // a new click starts a new outline: keep it undoable, drop brush edits of the previous one
      if (clock.current.first == null) { clock.current.first = elapsedMs(); saveTime(); }
      pushBaseHistory();
      const l = L.current; l.add.fill(0); l.erase.fill(0); l.edited = false; l.addZr = null; l.zr = l.baseZr;
    }
    requestOutline(p, undefined, !p.start && p.distMm >= 3);
  }, [requestOutline]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeTol = (t) => {
    setTol(t);
    if (!last.current) return;
    if (!tolSession.current) { pushBaseHistory(); tolSession.current = true; }
    clearTimeout(tolTimer.current); tolTimer.current = setTimeout(() => { tolSession.current = false; }, 800);
    requestOutline(last.current, t, true); // preview now, exact when the slider rests; brush edits are kept
  };

  const paint = useCallback(({ z, x, y, erase, start }) => {
    const s = seriesRef.current, l = L.current;
    if (!s || !l.mask) return;
    if (start) { stroke.current = { type: 'brush', idx: [], a: [], e: [] }; hist.current.push(stroke.current); if (hist.current.length > 40) hist.current.shift(); }
    const [nzs, ny, nx] = s.gd, cy = y / 2, cx = x / 2, r = brushMm / s.spDS[1], st = stroke.current;
    const depth = depthRef.current, half = Math.floor((depth - 1) / 2), z0 = Math.max(0, z - half), z1 = Math.min(nzs - 1, z + (depth - 1 - half));
    const a1 = erase ? 0 : 1, e1 = erase ? 1 : 0;
    for (let zz = z0; zz <= z1; zz++)
      for (let yy = Math.max(0, Math.floor(cy - r)); yy <= Math.min(ny - 1, Math.ceil(cy + r)); yy++)
        for (let xx = Math.max(0, Math.floor(cx - r)); xx <= Math.min(nx - 1, Math.ceil(cx + r)); xx++) {
          if ((yy - cy) ** 2 + (xx - cx) ** 2 > r * r) continue;
          const i = (zz * ny + yy) * nx + xx;
          if (l.add[i] === a1 && l.erase[i] === e1) continue;
          if (st) { st.idx.push(i); st.a.push(l.add[i]); st.e.push(l.erase[i]); }
          l.add[i] = a1; l.erase[i] = e1; l.mask[i] = (l.base[i] && !e1) || a1 ? 1 : 0;
        }
    l.edited = true;
    if (!erase) { l.addZr = unionZ(l.addZr, z0, z1); l.zr = joinZ(l.baseZr, l.addZr); }
    bump();
  }, [brushMm, bump]);

  // ---- loading ----
  const openGroup = useCallback(async (best) => {
    setChooser(null);
    setStatus(`Building volume from ${best.length} slices...`);
    await new Promise((r) => setTimeout(r, 20));
    const v = buildVolume(best);
    const ds = downsample(v.vol, v.dims), n = ds.v.length;
    const spDS = [v.spacing[0], v.spacing[1] * 2, v.spacing[2] * 2];
    L.current = { base: new Uint8Array(n), add: new Uint8Array(n), erase: new Uint8Array(n), mask: new Uint8Array(n), zr: null, baseZr: null, addZr: null, edited: false };
    hist.current = []; last.current = null; queued.current = null; inflight.current = false; setComputing(false);
    workerRef.current.postMessage({ type: 'init', v: ds.v.buffer, gd: ds.dims, sp: spDS }, [ds.v.buffer]);
    // lung model in the background: outlines work at once, and are upgraded when the lung limit is ready
    if (lungWorkerRef.current) lungWorkerRef.current.terminate();
    const id = ++lungId.current, lw = new LungWorker();
    lungWorkerRef.current = lw;
    setLungState({ phase: 'loading', done: 0, total: 1 });
    lw.onmessage = (ev) => {
      const r = ev.data;
      if (r.id !== lungId.current) return; // a newer scan replaced this one
      if (r.type === 'log') console.warn('[lung]', r.text);
      if (r.type === 'progress') setLungState({ phase: r.stage === 'model' ? 'loading' : r.stage === 'infer' ? 'running' : 'preparing', done: r.done, total: r.total, ep: r.ep });
      else if (r.type === 'error') setLungState({ phase: 'error', message: r.message });
      else if (r.type === 'done') {
        if (import.meta.env.DEV) window.__lung = { voxels: new Uint8Array(r.lung).reduce((s, x) => s + x, 0), backend: r.backend, ms: r.ms };
        workerRef.current.postMessage({ type: 'lung', lung: r.lung }, [r.lung]);
        setLungState({ phase: 'ready', backend: r.backend, ms: r.ms });
        if (last.current) { requestRef.current(last.current); setInfo('Outline updated with the lung limit.'); }
        lw.terminate();
      }
    };
    const copy = new Int16Array(v.vol); // the worker gets its own copy; the viewer keeps the original
    const forced = new URLSearchParams(window.location.search).get('ep'); // ?ep=wasm or ?ep=webgpu forces one backend
    lw.postMessage({ type: 'run', id, vol: copy.buffer, dims: v.dims, eps: forced ? [forced] : undefined }, [copy.buffer]);
    const s = { ...v, gd: ds.dims, spDS };
    seriesRef.current = s; setSeries(s);
    setSliceRaw(Math.floor(v.dims[0] / 2));
    setVersion((k) => k + 1); setInfo('');
    // outlines and time of this scan are remembered between sessions (matched by patient, series and size)
    const key = `${v.meta.patientId}|${v.meta.seriesNumber}|${v.dims.join('x')}|${v.meta.studyDate}`;
    const o = ol.current, saved = store(`outlines:${key}`, null);
    o.key = key; o.label = `${v.meta.patientId || 'Scan'} · series ${v.meta.seriesNumber}`;
    o.items = saved && saved.items.length ? saved.items.map((it) => ({ ...it, vol: it.rle ? (rleVoxels(it.rle) * spDS[0] * spDS[1] * spDS[2]) / 1000 : 0 })) : [{ id: 1, label: 'N1', zr: null, rle: null, vol: 0 }];
    o.next = Math.max(saved ? saved.next : 1, ...o.items.map((x) => x.id + 1)); o.active = o.items[0].id;
    loadEntry(o.items[0]); olSync();
    const t0 = store('timelog', {})[key];
    clock.current = { ms: t0 ? t0.ms : 0, since: Date.now(), first: t0 ? t0.first : null, rows: t0 ? t0.rows : [] };
    setPaused(false); setMinutes(clock.current.ms / 60000); saveTime();
    setStatus(`${v.meta.patientId || 'Scan'} · ${v.dims[0]} slices · ${v.spacing[1].toFixed(2)} mm pixels · ${v.spacing[0].toFixed(2)} mm slices`);
    const t = v.meta.thickness;
    setWarn(t > 1.3 ? `Slices are ${t.toFixed(2)} mm thick; the lab reads 1.0 to 1.25 mm series.` : '');
  }, []);

  const loadFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setStatus(`Reading ${files.length} files...`);
    const groups = {};
    for (const f of files) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const s = parseSlice(bytes);
        if (!(s.rows && s.cols)) continue;
        const key = `${s.uid || s.seriesNumber}|${s.rows}|${s.cols}`;
        (groups[key] ||= { key, bytes: [], number: s.seriesNumber, desc: s.desc, thickness: s.thickness, rows: s.rows, cols: s.cols }).bytes.push(bytes);
      } catch { /* not a DICOM image: skip */ }
    }
    // series with enough slices to be a scan, thin ones first, then the one with most slices
    const all = Object.values(groups).sort((p, q) => (Number(q.thickness <= 1.3) - Number(p.thickness <= 1.3)) || q.bytes.length - p.bytes.length);
    if (!all.length) { setStatus('No DICOM images found in that selection.'); return; }
    const cands = all.filter((g) => g.bytes.length >= 10);
    if (cands.length > 1) { setStatus(''); setChooser({ groups: cands, sel: 0 }); return; } // several series: let the user pick
    await openGroup((cands[0] || all[0]).bytes);
  }, [openGroup]);
  useEffect(() => { if (import.meta.env.DEV) window.__loadFiles = loadFiles; }, [loadFiles]);

  const winVal = useMemo(() => wl || WINDOWS[win], [wl, win]);
  const m = useMemo(() => (series && L.current.zr ? measure(L.current.mask, series.gd, series.spDS, L.current.zr) : null), [series, version]);

  const addRow = () => {
    if (!m) return;
    const cur = ol.current.items.find((x) => x.id === ol.current.active);
    clock.current.rows = [...clock.current.rows, elapsedMs()]; saveTime();
    setFlash(rows.length); setTimeout(() => setFlash(-1), 1600);
    setRows((rs) => [...rs, makeRow({ meta: series.meta, spacing: series.spacing, m, noduleId: cur ? cur.label : 'N1', timepoint, initials, minutes: elapsedMs() / 60000, includeVolume })]);
  };
  const edit = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const copy = async () => { await navigator.clipboard.writeText(toTSV(rows, false)); setStatus(`Copied ${rows.length} rows: paste into the sheet.`); };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCSV(rows)], { type: 'text/csv' })); a.download = 'tumour_rows.csv'; a.click();
  };

  // ---- keyboard: ignore only real text entry, so sliders and checkboxes keep the shortcuts ----
  const act = useRef({});
  act.current = { undo, clearAll, addRow, newOutline, togglePause, setSlice, goMeasured: () => { if (m) setSlice(m.bestSlice); } };
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target, tag = t.tagName;
      const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['range', 'checkbox', 'file', 'button'].includes(t.type));
      if (typing) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); act.current.undo(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const onControl = tag === 'INPUT' || tag === 'BUTTON'; // a focused slider keeps its own arrow keys
      if (k === 'arrowup' && !onControl) { e.preventDefault(); act.current.setSlice((s) => s - 1); }
      else if (k === 'arrowdown' && !onControl) { e.preventDefault(); act.current.setSlice((s) => s + 1); }
      else if (k === 'enter' && tag !== 'BUTTON') { e.preventDefault(); act.current.addRow(); }
      else if (k === 'o') setTool('outline');
      else if (k === 'b') setTool('add');
      else if (k === 'e') setTool('erase');
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); act.current.clearAll(); }
      else if (k === 'w') { setWl(null); setWin((w) => (w === 'Lung' ? 'Soft' : 'Lung')); }
      else if (k === 'n') act.current.newOutline();
      else if (k === 'p') act.current.togglePause();
      else if (k === 'm') act.current.goMeasured();
      else if (k === 'h' && !e.repeat) setHoldHide(true);
      else if (k === '+' || k === '=') viewerRef.current && viewerRef.current.zoomBy(1.25);
      else if (k === '-') viewerRef.current && viewerRef.current.zoomBy(1 / 1.25);
      else if (k === '0') viewerRef.current && viewerRef.current.fit();
      else if (k === '{') setBrushDepth((d) => Math.max(1, d - 2));
      else if (k === '}') setBrushDepth((d) => Math.min(15, d + 2));
      else if (k === '[') setBrushMm((b) => Math.max(1, b - 1));
      else if (k === ']') setBrushMm((b) => Math.min(15, b + 1));
    };
    const onKeyUp = (e) => { if (e.key.toLowerCase() === 'h') setHoldHide(false); };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  useEffect(() => {
    if (!timeOpen && !wlOpen) return undefined;
    const close = (e) => {
      if (e.type === 'keydown') { if (e.key === 'Escape') { setTimeOpen(false); setWlOpen(false); } return; }
      if (!e.target.closest('.timepanel, .timer')) setTimeOpen(false);
      if (!e.target.closest('.wlpanel, .wlbtn')) setWlOpen(false);
    };
    window.addEventListener('keydown', close); window.addEventListener('pointerdown', close);
    return () => { window.removeEventListener('keydown', close); window.removeEventListener('pointerdown', close); };
  }, [timeOpen, wlOpen]);

  useEffect(() => {
    if (!helpOpen) return undefined;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !e.target.closest('.help, .helpbtn')) setHelpOpen(false); };
    window.addEventListener('keydown', close); window.addEventListener('pointerdown', close);
    return () => { window.removeEventListener('keydown', close); window.removeEventListener('pointerdown', close); };
  }, [helpOpen]);

  // axis lines: live on the current slice while dragging or brushing, otherwise on the slice where the outline is largest
  let axesShow = null;
  if (series && L.current.zr) {
    if (gesture) { const g = axesOnSlice(L.current.mask, series.gd, series.spDS, slice); if (g) axesShow = { slice, ...g }; }
    else if (m) axesShow = { slice: m.bestSlice, ...m.axes };
  }

  const onDrop = async (e) => {
    e.preventDefault(); setOver(false);
    loadFiles(await filesFromDrop(e.dataTransfer.items));
  };

  return (
    <div className="app" style={{ gridTemplateRows: `52px minmax(0, 1fr) min(${Math.round(dataH)}px, 55vh)` }}>
      <header className="topbar">
        <div className="brandblock">
          <Logo />
          <div><b>Harbor Medical Center</b><span>Thoracic Oncology Research Lab</span></div>
        </div>
        <span className="divider" />
        <div className="brandblock product"><div><b>Lung Outline Tool</b><span>Research use only</span></div></div>
        <span className="grow" />
        {series && <LungChip s={lungState} />}
        {series && (
          <span className={`chip timer ${paused ? 'paused' : ''}`}>
            <button className="timebtn" title="Time on this scan: open the time log" aria-label="Open the time log" onClick={() => setTimeOpen((o) => !o)}><Icon name="clock" size={16} /> {minutes.toFixed(1)} min{paused ? ' · paused' : ''}</button>
            <button className="timebtn pausebtn" title={paused ? 'Resume the timer (P)' : 'Pause the timer (P)'} aria-label={paused ? 'Resume the timer' : 'Pause the timer'} onClick={togglePause}><Icon name={paused ? 'play' : 'pause'} size={14} /></button>
          </span>
        )}
        <button className="btn helpbtn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setHelpOpen((o) => !o)}><Icon name="help" size={15} /></button>
        {series && <FolderPicker onFiles={loadFiles} label="Open folder" />}
        {timeOpen && <TimePanel log={timeLog} nowKey={ol.current.key} liveMin={minutes} rows={rows} onClear={() => { setTimeLog({}); save('timelog', {}); }} />}
        {helpOpen && (
          <div className="help" role="dialog" aria-label="Keyboard shortcuts">
            <b>Keyboard shortcuts</b>
            {SHORTCUTS.map(([group, rows]) => (
              <div key={group} className="hgroup">
                <div className="hhead">{group}</div>
                {rows.map(([keys, what]) => (
                  <div key={keys.join('+')} className="hrow"><span className="keys">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span><span>{what}</span></div>
                ))}
              </div>
            ))}
          </div>
        )}
      </header>

      <section className="stage" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        {series ? (
          <>
              <Viewer ref={viewerRef} orient={orientationLabels(series.meta.iop)} onViewChange={setZoom} onGesture={(on) => { setGesture(on); if (!on && pendingExact.current && last.current) { clearTimeout(exactTimer.current); pendingExact.current = false; requestRef.current(last.current, undefined, false); } }} showOutline={!(hidePinned || holdHide)} axes={axesShow} vol={series.vol} dims={series.dims} spacing={series.spacing} gd={series.gd} mask={L.current.mask} version={version}
                slice={slice} win={winVal} tool={tool} onSlice={setSlice} onOutline={onOutline} onBrush={paint} />
            {status && (
              <div className="scaninfo" title={status}>
                {status.split(' · ').map((part, i) => <span key={i} className={i === 0 ? 'first' : ''}>{part}</span>)}
              </div>
            )}
            {warn && <div className="scanwarn" title={warn}><Icon name="alert" size={15} /> {warn}</div>}
            <div className="hintbar">{TOOLS.find((t) => t.id === tool).hint}</div>

            <div className="floating viewbar">
              <div className="toolwrap"><button className="vb" aria-label="Zoom out" onClick={() => viewerRef.current.zoomBy(1 / 1.25)}><Icon name="zoomout" size={18} /></button><Tip down title="Zoom out" keys="-" text="Ctrl/Cmd+scroll or pinch also zooms." /></div>
              <span className="zoomval">{Math.round(zoom * 100)}%</span>
              <div className="toolwrap"><button className="vb" aria-label="Zoom in" onClick={() => viewerRef.current.zoomBy(1.25)}><Icon name="zoomin" size={18} /></button><Tip down title="Zoom in" keys="+" text="Zooms around the centre. Ctrl/Cmd+scroll zooms at the cursor." /></div>
              <div className="toolwrap"><button className="vb" aria-label="Fit to window" onClick={() => viewerRef.current.fit()}><Icon name="fit" size={18} /></button><Tip down title="Fit" keys="0" text="Reset zoom. When zoomed, hold Space and drag to pan." /></div>
              <div className="vsep" />
              <div className="toolwrap"><button className={`vb ${hidePinned ? 'on' : ''}`} aria-label="Show or hide the outline" onClick={() => setHidePinned((h) => !h)}><Icon name={hidePinned ? 'eyeoff' : 'eye'} size={18} /></button><Tip down title="Outline on or off" keys="H" text="Hold H to peek at the raw image. Click to keep the outline hidden." /></div>
              <div className="vsep" />
              <div className="toolwrap">
                <div className="seg">{Object.keys(WINDOWS).map((w) => <button key={w} className={win === w && !wl ? 'on' : ''} aria-label={`${w} window`} onClick={() => { setWl(null); setWin(w); }}>{w}</button>)}</div>
                <Tip down title="Display window" keys="W" text="Lung shows the airways and nodules; Soft shows the chest wall and mediastinum." />
              </div>
              <div className="toolwrap"><button className={`vb wlbtn ${wl || wlOpen ? 'on' : ''}`} aria-label="Adjust level and width" onClick={() => setWlOpen((o) => !o)}><Icon name="sliders" size={18} /></button><Tip down title="Level and width" text="Fine-tune the brightness window by hand." /></div>
            </div>

            {wlOpen && (
              <div className="floating wlpanel" role="dialog" aria-label="Level and width">
                <div className="optlabel">Level <b>{Math.round(winVal.level)} HU</b></div>
                <input type="range" min="-1000" max="500" step="10" value={winVal.level} onChange={(e) => setWl({ ...winVal, level: +e.target.value })} />
                <div className="optlabel">Width <b>{Math.round(winVal.width)} HU</b></div>
                <input type="range" min="100" max="2500" step="50" value={winVal.width} onChange={(e) => setWl({ ...winVal, width: +e.target.value })} />
                <button className="btn tight" disabled={!wl} onClick={() => setWl(null)}>Back to {win}</button>
              </div>
            )}

            <nav className="floating toolbar">
              {TOOLS.map((t) => (
                <div key={t.id} className={`toolwrap ${tool === t.id ? 'active' : ''}`}>
                  <button className={`tool ${tool === t.id ? 'on' : ''}`} aria-label={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}>
                    <Icon name={t.icon} /><span>{t.label}</span>
                  </button>
                  <Tip title={t.label} keys={t.key} text={t.tip} />
                  {tool === t.id && (
                    <div className="floating toolopts">
                      {t.id === 'outline' ? (
                        <>
                          <div className="optlabel">Tolerance <b>{tol.toFixed(2)}</b></div>
                          <input type="range" min="0.2" max="0.8" step="0.01" value={tol} onChange={(e) => changeTol(+e.target.value)} />
                          <div className="optends"><span>more tissue</span><span>less</span></div>
                        </>
                      ) : (
                        <>
                          <div className="optlabel">Brush size <b>{brushMm} mm</b></div>
                          <input type="range" min="1" max="15" value={brushMm} onChange={(e) => setBrushMm(+e.target.value)} />
                          <div className="optends"><span>small</span><span><kbd>[</kbd> <kbd>]</kbd></span></div>
                          <div className="optlabel">Depth <b>{brushDepth === 1 ? '1 slice' : `${brushDepth} slices`}</b></div>
                          <input type="range" min="1" max="15" step="2" value={brushDepth} onChange={(e) => setBrushDepth(+e.target.value)} />
                          <div className="optends"><span>this slice</span><span><kbd>{'{'}</kbd> <kbd>{'}'}</kbd></span></div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div className="sep" />
              <div className="toolwrap">
                <button className="tool" aria-label="Undo (Ctrl/Cmd+Z)" onClick={undo}><Icon name="undo" /><span>Undo</span></button>
                <Tip title="Undo" keys="Ctrl/Cmd+Z" text="Undo the last outline or brush stroke." />
              </div>
              <div className="toolwrap">
                <button className="tool" aria-label="Clear (Delete)" onClick={clearAll}><Icon name="trash" /><span>Clear</span></button>
                <Tip title="Clear" keys="Del" text="Remove the whole outline. You can undo it." />
              </div>
            </nav>

            <aside className="floating inspector">
              <div>
                <div className="big">{m ? m.volumeMl.toFixed(2) : '-'}<small>mL</small></div>
                <p className="hint">{computing ? 'Computing…' : m ? (info || `Largest on slice ${m.bestSlice + 1}`) : info || 'No outline yet'}</p>
              </div>
              <div className="kv">
                <div><b>{m ? m.longMm.toFixed(1) : '-'}</b><span><i className="sw long" />long mm</span></div>
                <div><b>{m ? m.shortMm.toFixed(1) : '-'}</b><span><i className="sw short" />short mm</span></div>
                <div><b>{m ? m.meanMm.toFixed(1) : '-'}</b><span>mean mm</span></div>
              </div>
              <div className="olist">
                <div className="olhead"><span>Tumours on this scan</span><div className="toolwrap"><button className="iconbtn" aria-label="Start another tumour (N)" onClick={newOutline}><Icon name="plus" size={16} /></button><Tip down title="Another tumour" keys="N" text="Saves this outline and starts an empty one." /></div></div>
                {olView.map((o) => (
                  <div key={o.id} className={`olchip ${o.id === activeId ? 'on' : ''}`}>
                    <button className="olpick" onClick={() => switchTo(o.id)} title="Open this outline"><b>{o.label}</b><span>{(o.id === activeId && m ? m.volumeMl : o.vol) ? `${(o.id === activeId && m ? m.volumeMl : o.vol).toFixed(1)} mL` : 'empty'}</span></button>
                    {olView.length > 1 && <button className="olx" aria-label={`Delete ${o.label}`} title="Delete this outline" onClick={() => removeOutline(o.id)}>×</button>}
                  </div>
                ))}
              </div>
              {m && slice !== m.bestSlice && (
                <button className="btn tight" onClick={() => setSlice(m.bestSlice)}>Go to slice {m.bestSlice + 1} <kbd>M</kbd></button>
              )}
            </aside>

            <div className="floating slicev">
              <span className="slicecap">Slice</span>
              <span className="slicenum" title="Current slice">{slice + 1}</span>
              <input className="vslider" type="range" min="0" max={nz - 1} value={slice} aria-label="Slice" style={{ '--f': nz > 1 ? slice / (nz - 1) : 0 }} onChange={(e) => setSlice(+e.target.value)} />
              <span className="slicetot" title="Slices in the scan">{nz}</span>
            </div>
          </>
        ) : (
          <div className="empty">
            <div className={`drop ${over ? 'over' : ''}`}>
              <Icon name="folder" size={44} />
              <p className="pickdesc">Choose the folder that holds one CT scan, or drop it here.</p>
              <div className="pickrow"><FolderPicker onFiles={loadFiles} primary /></div>
              {status && <p className="pickhint">{status}</p>}
            </div>
          </div>
        )}
      </section>

      {chooser && (
        <div className="modal" role="dialog" aria-label="Choose a series" onKeyDown={(e) => { if (e.key === 'Escape') setChooser(null); }}>
          <div className="modalcard">
            <b>This folder holds several series</b>
            <div className="serieslist">
              {chooser.groups.map((g, i) => (
                <label key={g.key} className={`seriesrow ${chooser.sel === i ? 'on' : ''}`}>
                  <input type="radio" name="series" checked={chooser.sel === i} onChange={() => setChooser({ ...chooser, sel: i })} />
                  <span className="sdesc"><b>{g.desc || `Series ${g.number}`}</b><small>{g.bytes.length} slices · {g.thickness ? `${g.thickness.toFixed(2)} mm` : 'thickness unknown'} · {g.rows}×{g.cols}</small></span>
                  {g.thickness <= 1.3 && <span className="sbadge">thin</span>}
                </label>
              ))}
            </div>
            <div className="modalbtns">
              <button className="btn" onClick={() => setChooser(null)}>Cancel</button>
              <button className="btn primary" autoFocus onClick={() => openGroup(chooser.groups[chooser.sel].bytes)}>Open</button>
            </div>
          </div>
        </div>
      )}

      <section className="data">
        <div className="splitter" title="Drag to resize. Double-click to fit all rows." onPointerDown={onSplitDown} onPointerMove={onSplitMove} onPointerUp={onSplitUp} onPointerCancel={onSplitUp} onDoubleClick={fitAllRows} />
        <div className="dataHead">
          <b>Sheet rows</b><span className="count">{rows.length}</span>
          <label>Timepoint <input value={timepoint} onChange={(e) => setTimepoint(e.target.value)} /></label>
          <label>Initials <input value={initials} onChange={(e) => setInitials(e.target.value)} /></label>
          <label title="Untick to leave the volume cell blank, as in a measured-only row"><input type="checkbox" checked={includeVolume} onChange={(e) => setIncludeVolume(e.target.checked)} /> include volume</label>
          <span className="grow" />
          <button className="btn primary" disabled={!m} onClick={addRow}><Icon name="plus" size={15} /> Add row <kbd>Enter</kbd></button>
          <button className="btn" disabled={!rows.length} onClick={copy}><Icon name="copy" size={15} /> <span className="lbl">Copy rows</span></button>
          <button className="btn" disabled={!rows.length} onClick={download}><Icon name="download" size={15} /> <span className="lbl">CSV</span></button>
          <button className="btn ghost" disabled={!rows.length} onClick={() => setRows([])}><Icon name="trash" size={15} /> <span className="lbl">Clear</span></button>
        </div>
        <div className="tablewrap" ref={tableRef}>
          {rows.length ? (
            <table style={{ width: TABLE_W }}>
              <colgroup>
                <col style={{ width: 36 }} />
                {COLUMNS.map(([k]) => <col key={k} style={{ width: COLUMN_META[k].w }} />)}
                <col style={{ width: 44 }} />
              </colgroup>
              <thead>
                <tr className="grp">
                  <th className="stick0" />
                  {GROUPS.map((g) => <th key={g.name} colSpan={g.n} className={`g-${g.name}`}>{g.name}</th>)}
                  <th className="stickR" />
                </tr>
                <tr>
                  <th className="stick0">#</th>
                  {COLUMNS.map(([k, h], ci) => {
                    const [name, unit] = splitLabel(h);
                    return <th key={k} className={`${ci === 0 ? 'stick1' : ''} ${COLUMN_META[k].num ? 'num' : ''}`}>{name}{unit && <small>{unit}</small>}</th>;
                  })}
                  <th className="stickR" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={i === flash ? 'flash' : ''}>
                    <td className="stick0 idx">{i + 1}</td>
                    {COLUMNS.map(([k], ci) => {
                      const meta = COLUMN_META[k];
                      return (
                        <td key={k} className={`${ci === 0 ? 'stick1' : ''} ${meta.num ? 'num' : ''}`}>
                          {meta.select ? (
                            <select className="pill" data-v={r[k]} value={r[k]} onChange={(e) => edit(i, k, e.target.value)}>
                              {MATCH_OPTIONS.map((o) => <option key={o} value={o}>{o || 'Set status'}</option>)}
                            </select>
                          ) : meta.edit ? (
                            <input className="cell" placeholder="add" value={r[k]} onChange={(e) => edit(i, k, e.target.value)} />
                          ) : (
                            <span className={meta.measured ? 'measured' : ''}>{r[k] === '' ? '–' : r[k]}</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="stickR">
                      <button className="iconbtn" title="Delete this row" aria-label="Delete this row" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="emptyrows">
              <b>No rows yet</b>
              <ol>
                <li>Click a tumour to outline it.</li>
                <li>Check the outline and fix edges with the brush.</li>
                <li>Press <kbd>Enter</kbd> to add a row, then Copy rows and paste into Excel.</li>
              </ol>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
