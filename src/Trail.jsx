// The edit trail: every correction made on a scan (click, resize, tolerance, brush, erase, undo, ...) with the volume after it,
// so the lab can see how much hand work an outline or a proposed match needed. Kept in the browser per scan; exports to CSV.
import { useState } from 'react';

export const EDIT_KINDS = ['click', 'resize', 'tolerance', 'brush', 'erase', 'undo', 'clear']; // what counts as a correction after a match
const LABEL = { click: 'Click', resize: 'Drag resize', tolerance: 'Tolerance', brush: 'Brush add', erase: 'Brush erase', undo: 'Undo', clear: 'Clear', match: 'Match proposed', row: 'Row added', note: 'Note', image: 'Image saved' };
const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const num = (v) => (v == null ? '' : Math.round(v).toLocaleString('en-US'));

/** Per tumour: counts of each action, volume after the first outline and at the end, and how a matched proposal was handled. */
export function summarize(events) {
  const by = new Map();
  for (const e of events) { if (!by.has(e.tumour)) by.set(e.tumour, []); by.get(e.tumour).push(e); }
  return [...by.entries()].map(([tumour, ev]) => {
    const c = (k) => ev.filter((e) => e.kind === k).length;
    const stamped = ev.filter((e) => e.vol > 0);
    const first = stamped.length ? stamped[0].vol : null, last = stamped.length ? stamped[stamped.length - 1].vol : null;
    const m = ev.findIndex((e) => e.kind === 'match');
    let outcome = '';
    if (m >= 0) {
      const rowAt = ev.findIndex((e, i) => i > m && e.kind === 'row');
      const edits = ev.slice(m + 1, rowAt < 0 ? ev.length : rowAt).filter((e) => EDIT_KINDS.includes(e.kind)).length;
      outcome = rowAt < 0 && !edits ? 'proposed, not yet confirmed' : edits ? `proposal edited (${edits} edit${edits > 1 ? 's' : ''})` : 'proposal accepted as proposed';
    }
    return { tumour, click: c('click'), resize: c('resize'), tolerance: c('tolerance'), brush: c('brush') + c('erase'), undo: c('undo'), first, last, change: first && last != null ? Math.round((100 * (last - first)) / first) : null, outcome };
  });
}

export function trailCSV(events) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['Active time', 'Tumour', 'Action', 'Detail', 'Volume after (mm3)', 'Long axis (mm)', 'Short axis (mm)'];
  return [head.join(','), ...events.map((e) => [mmss(e.ms), e.tumour, LABEL[e.kind] || e.kind, e.detail, e.vol == null ? '' : Math.round(e.vol), e.long == null ? '' : e.long.toFixed(1), e.short == null ? '' : e.short.toFixed(1)].map(q).join(','))].join('\n');
}

export function TrailPanel({ events, scanLabel, onNote, onClear }) {
  const [note, setNote] = useState('');
  const sum = summarize(events);
  const csv = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([trailCSV(events)], { type: 'text/csv' })); a.download = 'edit_trail.csv'; a.click();
  };
  const add = () => { if (note.trim()) { onNote(note.trim()); setNote(''); } };
  return (
    <div className="help timepanel trailpanel" role="dialog" aria-label="Edit trail">
      <b>Edit trail</b>
      <p className="tnote">{scanLabel}. Every correction on this scan, in order, with the volume after it. Use notes to label edge cases (for example "chest wall leak, erased"); "Save image" in the toolbar keeps the slice with the outline.</p>
      {sum.length ? (
        <table className="ttable">
          <thead><tr><th>Tumour</th><th>Clicks</th><th>Resizes</th><th>Tolerance</th><th>Brush</th><th>Undos</th><th>First mm³</th><th>Now mm³</th><th>Change</th><th>Match</th></tr></thead>
          <tbody>
            {sum.map((r) => (
              <tr key={r.tumour}><td>{r.tumour}</td><td>{r.click}</td><td>{r.resize}</td><td>{r.tolerance}</td><td>{r.brush}</td><td>{r.undo}</td><td>{num(r.first)}</td><td>{num(r.last)}</td><td>{r.change == null ? '–' : `${r.change > 0 ? '+' : ''}${r.change}%`}</td><td style={{ textAlign: 'left' }}>{r.outcome || '–'}</td></tr>
            ))}
          </tbody>
        </table>
      ) : <p className="tnote">Nothing recorded on this scan yet.</p>}
      {events.length > 0 && (
        <div className="trailscroll">
          <table className="ttable">
            <thead><tr><th>Time</th><th>Tumour</th><th>Action</th><th>Detail</th><th>Volume mm³</th></tr></thead>
            <tbody>
              {events.slice().reverse().map((e) => (
                <tr key={e.id}><td>{mmss(e.ms)}</td><td>{e.tumour}</td><td style={{ textAlign: 'left' }}>{LABEL[e.kind] || e.kind}</td><td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{e.detail}</td><td>{num(e.vol)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="trailnote"><input value={note} placeholder="Note for the active tumour" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') add(); }} /><button className="btn" disabled={!note.trim()} onClick={add}>Add note</button></div>
      <div className="modalbtns"><button className="btn" disabled={!events.length} onClick={csv}>Download CSV</button><button className="btn ghost" disabled={!events.length} onClick={onClear}>Clear trail</button></div>
    </div>
  );
}
