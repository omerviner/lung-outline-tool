import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Viewer from './Viewer.jsx';
import { parseSlice, buildVolume } from './core/dicom.js';
import { downsample } from './core/blobs.js';
import { outlineFromClick } from './core/clickoutline.js';
import { measure } from './measure.js';
import { COLUMNS, MATCH_OPTIONS, makeRow, toTSV, toCSV } from './sheet.js';

const WINDOWS = { Lung: { level: -600, width: 1500 }, 'Soft tissue': { level: 40, width: 400 } };
const store = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

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
  const [rows, setRows] = useState(() => store('rows', []));
  const [initials, setInitials] = useState(() => store('initials', ''));
  const [timepoint, setTimepoint] = useState(() => store('timepoint', 'T0'));
  const [includeVolume, setIncludeVolume] = useState(true);
  const [header, setHeader] = useState(false);
  const [minutes, setMinutes] = useState(0);
  const maskRef = useRef(null), pending = useRef(null), busy = useRef(false), last = useRef(null), startedAt = useRef(0);

  useEffect(() => { try { localStorage.setItem('rows', JSON.stringify(rows)); } catch { /* storage unavailable */ } }, [rows]);
  useEffect(() => { try { localStorage.setItem('initials', JSON.stringify(initials)); localStorage.setItem('timepoint', JSON.stringify(timepoint)); } catch { /* storage unavailable */ } }, [initials, timepoint]);
  useEffect(() => { const t = setInterval(() => startedAt.current && setMinutes((Date.now() - startedAt.current) / 60000), 5000); return () => clearInterval(t); }, []);

  const nz = series ? series.dims[0] : 0;
  const setSlice = useCallback((f) => setSliceRaw((s) => Math.max(0, Math.min(nz - 1, typeof f === 'function' ? f(s) : f))), [nz]);
  useEffect(() => {
    const onKey = (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; if (e.key === 'ArrowUp') { e.preventDefault(); setSlice((s) => s - 1); } if (e.key === 'ArrowDown') { e.preventDefault(); setSlice((s) => s + 1); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSlice]);

  const loadFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList);
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
    const spDS = [v.spacing[0], v.spacing[1] * 2, v.spacing[2] * 2];
    maskRef.current = new Uint8Array(ds.v.length);
    setSeries({ ...v, v: ds.v, gd: ds.dims, spDS, ones: new Uint8Array(ds.v.length).fill(1) });
    setSliceRaw(Math.floor(v.dims[0] / 2));
    setVersion((n) => n + 1); setInfo(''); last.current = null;
    startedAt.current = Date.now(); setMinutes(0);
    setStatus(`${v.meta.patientId || 'scan'}: ${v.dims[0]} slices, ${v.spacing[1].toFixed(2)} mm pixels, ${v.spacing[0].toFixed(2)} mm slices`);
  }, []);
  useEffect(() => { if (import.meta.env.DEV) window.__loadFiles = loadFiles; }, [loadFiles]);

  const runOutline = useCallback((p) => {
    if (!series) return;
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
        setInfo(r.voxels ? `Outline in ${Math.round(performance.now() - t0)} ms, radius ${radiusMm.toFixed(0)} mm` : 'No outline here: click on the tumour tissue, not on air.');
      }
      if (pending.current) setTimeout(step, 0); else busy.current = false;
    };
    setTimeout(step, 0);
  }, [series, tol]);

  const changeTol = (t) => { setTol(t); if (last.current) runOutline({ ...last.current, tol: t }); };

  const paint = useCallback(({ z, x, y, erase }) => {
    if (!series) return;
    const [, ny, nx] = series.gd, m = maskRef.current, cy = y / 2, cx = x / 2, r = brushMm / series.spDS[1];
    for (let yy = Math.max(0, Math.floor(cy - r)); yy <= Math.min(ny - 1, Math.ceil(cy + r)); yy++)
      for (let xx = Math.max(0, Math.floor(cx - r)); xx <= Math.min(nx - 1, Math.ceil(cx + r)); xx++)
        if ((yy - cy) ** 2 + (xx - cx) ** 2 <= r * r) m[(z * ny + yy) * nx + xx] = erase ? 0 : 1;
    setVersion((n) => n + 1);
  }, [series, brushMm]);

  const m = useMemo(() => (series ? measure(maskRef.current, series.gd, series.spDS) : null), [series, version]);

  const addRow = () => {
    if (!m) return;
    const same = rows.filter((r) => r.patientId === series.meta.patientId && r.seriesNumber === series.meta.seriesNumber).length;
    setRows((rs) => [...rs, makeRow({ meta: series.meta, spacing: series.spacing, m, noduleId: `N${same + 1}`, timepoint, initials, minutes: (Date.now() - startedAt.current) / 60000, includeVolume })]);
  };
  const edit = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const copy = async () => { await navigator.clipboard.writeText(toTSV(rows, header)); setStatus(`Copied ${rows.length} rows (tab-separated): paste into the sheet.`); };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCSV(rows)], { type: 'text/csv' })); a.download = 'tumour_rows.csv'; a.click();
  };

  return (
    <main>
      <h1>Lung outline tool</h1>
      <p className="note">Research use only. Not for clinical use. Scans stay in your browser.</p>
      <div className="layout">
        <div>
          <div className="card">
            {series ? (
              <>
                <Viewer vol={series.vol} dims={series.dims} spacing={series.spacing} gd={series.gd} mask={maskRef.current} version={version}
                  slice={slice} win={WINDOWS[win]} tool={tool} onSlice={setSlice} onOutline={runOutline} onBrush={paint} />
                <div className="bar">
                  <input type="range" min="0" max={nz - 1} value={slice} onChange={(e) => setSlice(+e.target.value)} style={{ flex: 1 }} />
                  <span>slice {slice + 1} / {nz}</span>
                </div>
                <div className="bar">
                  {[['outline', 'Click outline'], ['add', 'Brush add'], ['erase', 'Brush erase']].map(([k, label]) => (
                    <button key={k} className={tool === k ? 'on' : ''} onClick={() => setTool(k)}>{label}</button>
                  ))}
                  <select value={win} onChange={(e) => setWin(e.target.value)}>{Object.keys(WINDOWS).map((w) => <option key={w}>{w}</option>)}</select>
                  <button onClick={() => { maskRef.current.fill(0); setVersion((n) => n + 1); setInfo(''); last.current = null; }}>Clear</button>
                </div>
                <div className="bar">
                  <label>Tolerance <input type="range" min="0.2" max="0.8" step="0.01" value={tol} onChange={(e) => changeTol(+e.target.value)} /> {tol.toFixed(2)}</label>
                  <label>Brush <input type="range" min="1" max="15" value={brushMm} onChange={(e) => setBrushMm(+e.target.value)} /> {brushMm} mm</label>
                </div>
                <p className="note">Click the tumour. Drag outward to set a larger radius. Scroll or use the arrow keys to change slice. Shift while brushing erases. {info}</p>
              </>
            ) : (
              <div className="drop">
                <p>Load a CT series: choose the folder of DICOM files.</p>
                <input type="file" webkitdirectory="true" directory="true" multiple onChange={(e) => loadFiles(e.target.files)} />
              </div>
            )}
            {status && <p className="note">{status}</p>}
            {series && <button onClick={() => { setSeries(null); setStatus(''); startedAt.current = 0; }}>Load another scan</button>}
          </div>
        </div>
        <div>
          <div className="card">
            <div className="stats">
              <div className="stat"><b>{m ? m.volumeMl.toFixed(2) : '-'}</b><span>volume (mL)</span></div>
              <div className="stat"><b>{m ? m.longMm.toFixed(1) : '-'}</b><span>long axis (mm)</span></div>
              <div className="stat"><b>{m ? m.shortMm.toFixed(1) : '-'}</b><span>short axis (mm)</span></div>
              <div className="stat"><b>{m ? m.meanMm.toFixed(1) : '-'}</b><span>mean diameter (mm)</span></div>
            </div>
            <p className="note">{m ? `Largest on slice ${m.bestSlice + 1} (spans ${m.firstSlice + 1}-${m.lastSlice + 1}). Axes are approximate, not RECIST.` : 'No outline yet.'} Minutes on scan: {minutes.toFixed(1)}</p>
            <div className="bar">
              <label>Timepoint <input value={timepoint} onChange={(e) => setTimepoint(e.target.value)} size="4" /></label>
              <label>Initials <input value={initials} onChange={(e) => setInitials(e.target.value)} size="4" /></label>
              <label><input type="checkbox" checked={includeVolume} onChange={(e) => setIncludeVolume(e.target.checked)} /> include volume</label>
              <button className="primary" disabled={!m} onClick={addRow}>Add row to sheet</button>
            </div>
          </div>
          <div className="card">
            <div className="bar">
              <b>Rows ({rows.length})</b>
              <button disabled={!rows.length} onClick={copy}>Copy rows</button>
              <label><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> with header</label>
              <button disabled={!rows.length} onClick={download}>Download CSV</button>
              <button disabled={!rows.length} onClick={() => setRows([])}>Clear rows</button>
            </div>
            <div className="tablewrap">
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
            </div>
            <p className="note">Copy rows pastes tab-separated text into Excel, one value per cell, in your sheet's column order. Fill lobe, type, solid component, match status and notes in the table first.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
