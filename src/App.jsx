import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Viewer from './Viewer.jsx';
import { Icon } from './icons.jsx';
import { parseSlice, buildVolume } from './core/dicom.js';
import { downsample } from './core/blobs.js';
import { outlineFromClick } from './core/clickoutline.js';
import { measure } from './measure.js';
import { COLUMNS, MATCH_OPTIONS, makeRow, toTSV, toCSV } from './sheet.js';

const WINDOWS = { Lung: { level: -600, width: 1500 }, Soft: { level: 40, width: 400 } };
const TOOLS = [
  ['outline', 'target', 'Click outline (O)'],
  ['add', 'brush', 'Brush: add (B)'],
  ['erase', 'eraser', 'Brush: erase (E, or hold Shift)'],
];
const store = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

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
  const [tol, setTol] = useState(0.45);
  const [brushMm, setBrushMm] = useState(4);
  const [version, setVersion] = useState(0);
  const [info, setInfo] = useState('');
  const [over, setOver] = useState(false);
  const [rows, setRows] = useState(() => store('rows', []));
  const [initials, setInitials] = useState(() => store('initials', ''));
  const [timepoint, setTimepoint] = useState(() => store('timepoint', 'T0'));
  const [includeVolume, setIncludeVolume] = useState(true);
  const [header, setHeader] = useState(false);
  const [minutes, setMinutes] = useState(0);
  const maskRef = useRef(null), pending = useRef(null), busy = useRef(false), last = useRef(null), startedAt = useRef(0), hist = useRef([]);

  useEffect(() => save('rows', rows), [rows]);
  useEffect(() => { save('initials', initials); save('timepoint', timepoint); }, [initials, timepoint]);
  useEffect(() => { const t = setInterval(() => startedAt.current && setMinutes((Date.now() - startedAt.current) / 60000), 5000); return () => clearInterval(t); }, []);

  const nz = series ? series.dims[0] : 0;
  const setSlice = useCallback((f) => setSliceRaw((s) => Math.max(0, Math.min(nz - 1, typeof f === 'function' ? f(s) : f))), [nz]);

  const pushHistory = () => {
    if (!maskRef.current) return;
    hist.current.push(maskRef.current.slice());
    if (hist.current.length > 8) hist.current.shift();
  };
  const undo = useCallback(() => {
    const prev = hist.current.pop();
    if (!prev) return;
    maskRef.current = prev; setVersion((n) => n + 1); setInfo('Undid the last change.');
  }, []);
  const clearMask = () => { pushHistory(); maskRef.current.fill(0); setVersion((n) => n + 1); setInfo(''); last.current = null; };

  const loadFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setStatus(`Reading ${files.length} files...`);
    const parsed = [];
    for (const f of files) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const s = parseSlice(bytes);
        if (s.rows && s.cols) parsed.push({ bytes, key: `${s.seriesNumber}|${s.rows}|${s.cols}` });
      } catch { /* not a DICOM image: skip */ }
    }
    if (!parsed.length) { setStatus('No DICOM images found in that selection.'); return; }
    const groups = {};
    parsed.forEach((p) => { (groups[p.key] ||= []).push(p.bytes); });
    const best = Object.values(groups).sort((a, b) => b.length - a.length)[0];
    setStatus(`Building volume from ${best.length} slices...`);
    await new Promise((r) => setTimeout(r, 20));
    const v = buildVolume(best);
    const ds = downsample(v.vol, v.dims);
    maskRef.current = new Uint8Array(ds.v.length);
    hist.current = []; last.current = null;
    setSeries({ ...v, v: ds.v, gd: ds.dims, spDS: [v.spacing[0], v.spacing[1] * 2, v.spacing[2] * 2], ones: new Uint8Array(ds.v.length).fill(1) });
    setSliceRaw(Math.floor(v.dims[0] / 2));
    setVersion((n) => n + 1); setInfo('');
    startedAt.current = Date.now(); setMinutes(0);
    setStatus(`${v.meta.patientId || 'Scan'} · ${v.dims[0]} slices · ${v.spacing[1].toFixed(2)} mm pixels · ${v.spacing[0].toFixed(2)} mm slices`);
  }, []);
  useEffect(() => { if (import.meta.env.DEV) window.__loadFiles = loadFiles; }, [loadFiles]);

  const runOutline = useCallback((p) => {
    if (!series) return;
    if (p.start) pushHistory();
    last.current = p;
    pending.current = p;
    if (busy.current) return;
    busy.current = true;
    const step = () => {
      const q = pending.current; pending.current = null;
      if (q) {
        const seed = [q.z, Math.min(series.gd[1] - 1, Math.floor(q.y / 2)), Math.min(series.gd[2] - 1, Math.floor(q.x / 2))];
        const radiusMm = q.distMm < 3 ? 25 : Math.max(6, q.distMm);
        const t0 = performance.now();
        const r = outlineFromClick(series.v, series.gd, series.spDS, series.ones, seed, { t: q.tol ?? tol, radiusMm, openR: 2, useLung: false });
        maskRef.current = r.mask; setVersion((n) => n + 1);
        setInfo(r.voxels ? `Outline in ${Math.round(performance.now() - t0)} ms · radius ${radiusMm.toFixed(0)} mm` : 'No outline here: click on the tumour tissue, not on air.');
      }
      if (pending.current) setTimeout(step, 0); else busy.current = false;
    };
    setTimeout(step, 0);
  }, [series, tol]);

  const changeTol = (t) => { setTol(t); if (last.current) runOutline({ ...last.current, start: false, tol: t }); };

  const paint = useCallback(({ z, x, y, erase, start }) => {
    if (!series) return;
    if (start) pushHistory();
    const [, ny, nx] = series.gd, m = maskRef.current, cy = y / 2, cx = x / 2, r = brushMm / series.spDS[1];
    for (let yy = Math.max(0, Math.floor(cy - r)); yy <= Math.min(ny - 1, Math.ceil(cy + r)); yy++)
      for (let xx = Math.max(0, Math.floor(cx - r)); xx <= Math.min(nx - 1, Math.ceil(cx + r)); xx++)
        if ((yy - cy) ** 2 + (xx - cx) ** 2 <= r * r) m[(z * ny + yy) * nx + xx] = erase ? 0 : 1;
    setVersion((n) => n + 1);
  }, [series, brushMm]);

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowup') { e.preventDefault(); setSlice((s) => s - 1); }
      else if (k === 'arrowdown') { e.preventDefault(); setSlice((s) => s + 1); }
      else if (k === 'o') setTool('outline');
      else if (k === 'b') setTool('add');
      else if (k === 'e') setTool('erase');
      else if (k === '[') setBrushMm((b) => Math.max(1, b - 1));
      else if (k === ']') setBrushMm((b) => Math.min(15, b + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSlice, undo]);

  const m = useMemo(() => (series ? measure(maskRef.current, series.gd, series.spDS) : null), [series, version]);

  const addRow = () => {
    if (!m) return;
    const same = rows.filter((r) => r.patientId === series.meta.patientId && r.seriesNumber === series.meta.seriesNumber).length;
    setRows((rs) => [...rs, makeRow({ meta: series.meta, spacing: series.spacing, m, noduleId: `N${same + 1}`, timepoint, initials, minutes: (Date.now() - startedAt.current) / 60000, includeVolume })]);
  };
  const edit = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const copy = async () => { await navigator.clipboard.writeText(toTSV(rows, header)); setStatus(`Copied ${rows.length} rows: paste into the sheet.`); };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCSV(rows)], { type: 'text/csv' })); a.download = 'tumour_rows.csv'; a.click();
  };

  const onDrop = async (e) => {
    e.preventDefault(); setOver(false);
    loadFiles(await filesFromDrop(e.dataTransfer.items));
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Lung outline tool</span>
        <span className="tag">research use only</span>
        <span className="status">{status}</span>
        {series && <span className="chip"><Icon name="clock" size={16} /> {minutes.toFixed(1)} min on scan</span>}
        <label className="btn">
          <Icon name="folder" size={17} /> {series ? 'Open another scan' : 'Open scan folder'}
          <input type="file" webkitdirectory="true" directory="true" multiple onChange={(e) => loadFiles(e.target.files)} />
        </label>
      </header>

      <section className="stage" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        {series ? (
          <>
            <div className="canvasWrap">
              <Viewer vol={series.vol} dims={series.dims} spacing={series.spacing} gd={series.gd} mask={maskRef.current} version={version}
                slice={slice} win={WINDOWS[win]} tool={tool} onSlice={setSlice} onOutline={runOutline} onBrush={paint} />
            </div>
            <div className="hud">slice {slice + 1} / {nz} · {win} window</div>

            <nav className="floating toolbar">
              {TOOLS.map(([k, icon, label]) => (
                <button key={k} className={`tool ${tool === k ? 'on' : ''}`} title={label} aria-label={label} onClick={() => setTool(k)}><Icon name={icon} /></button>
              ))}
              <div className="sep" />
              <button className="tool" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" onClick={undo}><Icon name="undo" /></button>
              <button className="tool" title="Clear outline" aria-label="Clear outline" onClick={clearMask}><Icon name="trash" /></button>
              <div className="sep" />
              <button className="tool" title={`Window: ${win} (click to switch)`} aria-label="Switch window" onClick={() => setWin((w) => (w === 'Lung' ? 'Soft' : 'Lung'))}><Icon name="contrast" /></button>
            </nav>

            <aside className="floating inspector">
              <div>
                <div className="big">{m ? m.volumeMl.toFixed(2) : '-'}<small>mL</small></div>
                <p className="hint">{m ? `Largest on slice ${m.bestSlice + 1}, spans ${m.firstSlice + 1}-${m.lastSlice + 1}` : 'Click the tumour to outline it.'}</p>
              </div>
              <div className="kv">
                <div><b>{m ? m.longMm.toFixed(1) : '-'}</b><span>long mm</span></div>
                <div><b>{m ? m.shortMm.toFixed(1) : '-'}</b><span>short mm</span></div>
                <div><b>{m ? m.meanMm.toFixed(1) : '-'}</b><span>mean mm</span></div>
              </div>
              <div className="field">Window
                <div className="seg">{Object.keys(WINDOWS).map((w) => <button key={w} className={win === w ? 'on' : ''} onClick={() => setWin(w)}>{w}</button>)}</div>
              </div>
              <div className="field">Tolerance
                <div className="row"><input type="range" min="0.2" max="0.8" step="0.01" value={tol} onChange={(e) => changeTol(+e.target.value)} />{tol.toFixed(2)}</div>
              </div>
              <div className="field">Brush size
                <div className="row"><input type="range" min="1" max="15" value={brushMm} onChange={(e) => setBrushMm(+e.target.value)} />{brushMm} mm</div>
              </div>
              <p className="hint">Click the tumour; drag outward for a larger radius. Scroll or use the arrow keys to change slice. {info}</p>
            </aside>

            <div className="floating slicebar">
              <span>slice</span>
              <input type="range" min="0" max={nz - 1} value={slice} onChange={(e) => setSlice(+e.target.value)} />
              <span>{slice + 1}</span>
            </div>
          </>
        ) : (
          <div className="empty">
            <div className={`drop ${over ? 'over' : ''}`}>
              <Icon name="folder" size={40} />
              <h2>Open a CT scan</h2>
              <div>Drop a folder of DICOM files here, or choose one. Scans stay in your browser.</div>
              <label className="btn primary">
                <Icon name="folder" size={17} /> Choose scan folder
                <input type="file" webkitdirectory="true" directory="true" multiple onChange={(e) => loadFiles(e.target.files)} />
              </label>
            </div>
          </div>
        )}
      </section>

      <section className="data">
        <div className="dataHead">
          <b>Sheet rows ({rows.length})</b>
          <label>Timepoint <input value={timepoint} onChange={(e) => setTimepoint(e.target.value)} /></label>
          <label>Initials <input value={initials} onChange={(e) => setInitials(e.target.value)} /></label>
          <label><input type="checkbox" checked={includeVolume} onChange={(e) => setIncludeVolume(e.target.checked)} /> include volume</label>
          <span className="grow" />
          <button className="btn primary" disabled={!m} onClick={addRow}><Icon name="plus" size={17} /> Add row</button>
          <label className="chip"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> header</label>
          <button className="btn" disabled={!rows.length} onClick={copy}><Icon name="copy" size={17} /> Copy rows</button>
          <button className="btn" disabled={!rows.length} onClick={download}><Icon name="download" size={17} /> CSV</button>
          <button className="btn ghost" disabled={!rows.length} onClick={() => setRows([])}><Icon name="trash" size={17} /> Clear</button>
        </div>
        <div className="tablewrap">
          {rows.length ? (
            <table>
              <thead><tr>{COLUMNS.map(([, h]) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {COLUMNS.map(([k]) => (
                      <td key={k}>
                        {k === 'matchStatus' ? <select value={r[k]} onChange={(e) => edit(i, k, e.target.value)}>{MATCH_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select>
                          : ['lobe', 'type', 'solid', 'notes'].includes(k) ? <input value={r[k]} onChange={(e) => edit(i, k, e.target.value)} /> : r[k]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="emptyrows">No rows yet. Outline a tumour and press Add row. Copy rows pastes into Excel in your sheet's column order.</div>
          )}
        </div>
      </section>
    </div>
  );
}
