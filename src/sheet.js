// One row per tumour, in the lab's sheet column order. Daniel only fills lobe, type, solid component,
// match status and notes; everything else is filled from the scan and the outline.

export const COLUMNS = [
  ['patientId', 'Patient ID'], ['date', 'Date'], ['timepoint', 'Timepoint'], ['seriesNumber', 'Series number'],
  ['sliceThickness', 'Slice thickness (mm)'], ['noduleId', 'Nodule ID'], ['lobe', 'Lobe'], ['sliceNumber', 'Slice number'],
  ['type', 'Type'], ['longMm', 'Long axis (mm)'], ['shortMm', 'Short axis (mm)'], ['meanMm', 'Mean diameter (mm)'],
  ['solid', 'Solid component'], ['volumeMm3', 'Volume (mm3)'], ['matchStatus', 'Match status'],
  ['minutes', 'Minutes on scan'], ['initials', 'Initials'], ['notes', 'Notes'],
];

export const MATCH_OPTIONS = ['', 'Confident', 'Uncertain'];

export function fmtDate(d) {
  return d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d || '';
}

export function makeRow({ meta, spacing, m, noduleId, timepoint, initials, minutes, includeVolume }) {
  return {
    patientId: meta.patientId || '', date: fmtDate(meta.studyDate), timepoint, seriesNumber: meta.seriesNumber ?? '',
    sliceThickness: +spacing[0].toFixed(2), noduleId, lobe: '', sliceNumber: m.bestSlice + 1, type: '',
    longMm: +m.longMm.toFixed(1), shortMm: +m.shortMm.toFixed(1), meanMm: +m.meanMm.toFixed(1), solid: '',
    volumeMm3: includeVolume ? Math.round(m.volumeMl * 1000) : '', matchStatus: '', minutes: +minutes.toFixed(1),
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
  noduleId: { group: 'Nodule', w: 92, edit: true }, lobe: { group: 'Nodule', w: 92, edit: true }, sliceNumber: { group: 'Nodule', w: 108, num: true },
  type: { group: 'Nodule', w: 112, edit: true },
  longMm: { group: 'Measurements', w: 100, num: true, measured: true }, shortMm: { group: 'Measurements', w: 104, num: true, measured: true },
  meanMm: { group: 'Measurements', w: 122, num: true, measured: true }, solid: { group: 'Measurements', w: 132, edit: true },
  volumeMm3: { group: 'Measurements', w: 100, num: true, measured: true },
  matchStatus: { group: 'Review', w: 132, select: true }, minutes: { group: 'Review', w: 130, num: true },
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
