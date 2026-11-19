// One row per tumour, in the lab's sheet column order. Daniel only fills lobe, type, solid component,
// match status and notes; everything else is filled from the scan and the outline.

// Column names and order as in the lab's sheet (example rows from Daniel, 18 Nov 2026).
export const COLUMNS = [
  ['patientId', 'Patient ID'], ['date', 'Scan date'], ['timepoint', 'Timepoint'], ['seriesNumber', 'Series'],
  ['sliceThickness', 'Slice thickness'], ['noduleId', 'Nodule ID'], ['lobe', 'Lobe'], ['sliceNumber', 'Slice'],
  ['type', 'Type'], ['longMm', 'Long axis'], ['shortMm', 'Short axis'], ['meanMm', 'Mean diameter'],
  ['solid', 'Solid component'], ['volumeMm3', 'Volume'], ['matchStatus', 'Match to prior'],
  ['minutes', 'Minutes'], ['initials', 'Initials'], ['notes', 'Notes'],
];
export const UNITS = { sliceThickness: 'mm', longMm: 'mm', shortMm: 'mm', meanMm: 'mm', solid: '', volumeMm3: 'mm3' }; // shown in the table header only

export const TIMEPOINTS = ['Baseline', 'Follow-up 1', 'Follow-up 2', 'Follow-up 3', 'Follow-up 4'];
// Drop-down cells, with the lab's own wording
export const OPTIONS = {
  lobe: ['', 'Right Upper Lobe', 'Right Middle Lobe', 'Right Lower Lobe', 'Left Upper Lobe', 'Left Lower Lobe'],
  type: ['', 'Solid', 'Part-solid', 'Ground-glass'],
  matchStatus: ['', 'Confident', 'Uncertain'],
};
export const PLACEHOLDER = { lobe: 'Set lobe', type: 'Set type', matchStatus: 'Set status' };

export function fmtDate(d) {
  return d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d || '';
}

/** Dates pasted from a sheet (2025/01/14, 20250114, 14/01/2025, 1/14/2025) as YYYY-MM-DD; anything unclear stays as typed. */
export function normDate(v) {
  const t = String(v || '').trim(); let m;
  const iso = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t))) return iso(m[1], m[2], m[3]);
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(t))) return iso(m[1], m[2], m[3]);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t))) {
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) return iso(m[3], b, a);
    if (b > 12 && a <= 12) return iso(m[3], a, b);
  }
  return t;
}

export function makeRow({ meta, spacing, m, noduleId, timepoint, initials, minutes, includeVolume, matchStatus = '', lobe = '', type = '' }) {
  return {
    patientId: meta.patientId || '', date: fmtDate(meta.studyDate), timepoint, seriesNumber: meta.seriesNumber ?? '',
    sliceThickness: +spacing[0].toFixed(2), noduleId, lobe, sliceNumber: m.bestSlice + 1, type,
    longMm: +m.longMm.toFixed(1), shortMm: +m.shortMm.toFixed(1), meanMm: +m.meanMm.toFixed(1), solid: '',
    volumeMm3: includeVolume ? Math.round(m.volumeMl * 1000) : '', matchStatus, minutes: +minutes.toFixed(1),
    initials, notes: '',
  };
}

const clean = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');

/** Tab-separated text: pastes into Excel with one value per cell. */
export function toTSV(rows, header = false) {
  const lines = rows.map((r) => COLUMNS.map(([k]) => clean(r[k])).join('\t'));
  if (header) lines.unshift(COLUMNS.map(([, h]) => h).join('\t'));
  return lines.join('\n');
}

export function toCSV(rows) {
  const q = (v) => { const s = clean(v); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [COLUMNS.map(([, h]) => q(h)).join(','), ...rows.map((r) => COLUMNS.map(([k]) => q(r[k])).join(','))].join('\n');
}

// UI-only metadata: group, width, alignment and which cells the user fills in.
export const COLUMN_META = {
  patientId: { group: 'Scan', w: 156 }, date: { group: 'Scan', w: 102 }, timepoint: { group: 'Scan', w: 94 },
  seriesNumber: { group: 'Scan', w: 116, num: true }, sliceThickness: { group: 'Scan', w: 130, num: true },
  noduleId: { group: 'Nodule', w: 92, edit: true }, lobe: { group: 'Nodule', w: 160, select: true }, sliceNumber: { group: 'Nodule', w: 108, num: true },
  type: { group: 'Nodule', w: 124, select: true },
  longMm: { group: 'Measurements', w: 100, num: true, measured: true }, shortMm: { group: 'Measurements', w: 104, num: true, measured: true },
  meanMm: { group: 'Measurements', w: 122, num: true, measured: true }, solid: { group: 'Measurements', w: 132, edit: true },
  volumeMm3: { group: 'Measurements', w: 100, num: true, measured: true },
  matchStatus: { group: 'Review', w: 140, select: true }, minutes: { group: 'Review', w: 130, num: true },
  initials: { group: 'Review', w: 84 }, notes: { group: 'Review', w: 260, edit: true },
};

/** Consecutive columns of the same group, for the group header band. */
export function groupSpans() {
  const out = [];
  for (const [k] of COLUMNS) {
    const g = COLUMN_META[k].group, last = out[out.length - 1];
    if (last && last.name === g) last.n++; else out.push({ name: g, n: 1 });
  }
  return out;
}

/** 'Long axis (mm)' -> ['Long axis', 'mm'] */
export function splitLabel(h) {
  const m = h.match(/^(.*?)\s*\((.*)\)$/);
  return m ? [m[1], m[2]] : [h, ''];
}

/**
 * Read rows pasted from the lab's sheet (tab-separated from Excel, or comma-separated), with or without the header line.
 * Columns are matched by header name when there is a header, otherwise by the sheet's column order. Returns { rows, skipped }.
 */
export function parseRows(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], skipped: 0 };
  const split = (l) => (l.includes('\t') ? l.split('\t') : l.split(/\s*,\s*/)).map((c) => c.replace(/^"|"$/g, '').trim());
  const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
  const first = split(lines[0]);
  const hasHeader = first.some((c) => norm(c) === 'patientid' || norm(c) === 'scandate' || norm(c) === 'timepoint');
  let keys = COLUMNS.map(([k]) => k);
  if (hasHeader) {
    const byHeader = Object.fromEntries(COLUMNS.map(([k, h]) => [norm(h), k]));
    keys = first.map((c) => byHeader[norm(c)] || null);
  }
  const rows = []; let skipped = 0;
  for (const l of hasHeader ? lines.slice(1) : lines) {
    const cells = split(l), r = Object.fromEntries(COLUMNS.map(([k]) => [k, '']));
    cells.forEach((c, i) => { if (keys[i]) r[keys[i]] = c; });
    if (!r.patientId || !r.noduleId) { skipped++; continue; } // not a sheet row
    rows.push({ ...r, date: normDate(r.date), imported: true });
  }
  return { rows, skipped };
}
