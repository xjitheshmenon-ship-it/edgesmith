/**
 * Shared client-side export helpers — JSON, CSV, and PDF.
 *
 * Used by the Cycle Builder (export a cycle definition) and Reports (export
 * any report table). All three produce a real downloaded file; nothing is sent
 * to the server.
 *
 *   columns: [{ key, label }]   — column order + headers
 *   rows:    [{ [key]: value }] — one object per row
 */
/** Trigger a browser download for an in-memory Blob. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Download an object as pretty-printed JSON. */
export function downloadJSON(filename, obj) {
  downloadBlob(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), ensureExt(filename, 'json'));
}

/** Escape a single CSV cell per RFC 4180 (quote if it contains , " or newline). */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Download tabular data as CSV. */
export function downloadCSV(filename, columns, rows) {
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(',')).join('\r\n');
  const csv = `${header}\r\n${body}`;
  // Prepend a UTF-8 BOM so Excel opens accented characters correctly.
  downloadBlob(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }), ensureExt(filename, 'csv'));
}

/**
 * Download tabular data as a PDF table.
 * opts: { title?, subtitle?, columns, rows, orientation? }
 */
export async function downloadPDF(filename, { title, subtitle, columns, rows, orientation = 'portrait' }) {
  // Lazy-loaded so jsPDF (~300KB) is only fetched when a PDF is actually exported,
  // keeping it out of the initial page bundle.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
  const marginX = 40;
  let cursorY = 48;

  if (title) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(21, 54, 106); // brand navy
    doc.text(String(title), marginX, cursorY);
    cursorY += 18;
  }
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 130, 145);
    doc.text(String(subtitle), marginX, cursorY);
    cursorY += 8;
  }

  autoTable(doc, {
    startY: cursorY + 6,
    margin: { left: marginX, right: marginX },
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => {
      const v = r[c.key];
      return v === null || v === undefined ? '' : String(v);
    })),
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [17, 48, 95], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [244, 247, 250] },
  });

  doc.save(ensureExt(filename, 'pdf'));
}

/** Ensure the filename ends with the given extension. */
function ensureExt(filename, ext) {
  const clean = String(filename || 'export').replace(/[\\/:*?"<>|]+/g, '-');
  return clean.toLowerCase().endsWith(`.${ext}`) ? clean : `${clean}.${ext}`;
}
