// Shared document chrome for every PDF this product generates — the
// statement, the receipt, and the tabular report exports.
//
// It exists because those three were drifting: exporters.js had already
// grown a branded navy masthead, zebra table bands and right-aligned money
// columns, while statementPdf.js and receiptPdf.js were still the original
// "church name, grey hairline, plain rows" layout. A member could receive a
// receipt and a statement from the same church in the same week and see two
// unrelated documents. Putting the chrome in one place is what makes them
// one system, and follows the same "reusable export infrastructure, not an
// engine per report" rule exporters.js's own header states.
//
// Palette mirrors src/styles/themes.css so an exported document is
// recognisably the same product as the screen it came from.
export const PALETTE = {
  navy: '#0b1f4d',
  navySoft: '#123262',
  green: '#10b981',
  ink: '#1e293b',
  muted: '#5b6b8c',
  hairline: '#dbe2ef',
  zebra: '#f4f7fc',
  onNavy: '#ffffff',
  onNavyMuted: '#c7d2e8',
};

export const MASTHEAD_HEIGHT = 78;
const ACCENT_RULE_HEIGHT = 3;

// pdfkit's characterSpacing is in POINTS, not em. The design calls for
// 0.05em of tracking on the church name, so it has to be resolved against
// the font size it is applied at — 0.05em at 16pt is 0.8pt, at 9pt it is
// 0.45pt. Hardcoding a single point value would make the tracking visually
// wrong at every size except the one it was tuned for.
export const trackingFor = (fontSize, em = 0.05) => fontSize * em;

/**
 * Truncates `text` to fit `maxWidth` at the CURRENTLY selected font/size,
 * appending an ellipsis if it had to cut.
 *
 * pdfkit's own `{ ellipsis: true, lineBreak: false }` does not reliably
 * prevent a long single-line string from wrapping — a real church name
 * ("Kanisa la Mfano la Ushindi Tanzania" at 15pt with 0.05em tracking is
 * 333pt against 307pt of available masthead) spilled onto a second line and
 * overlapped the document title beneath it. Measuring and cutting the
 * string ourselves is the only way to guarantee one line, so every masthead
 * string goes through this rather than trusting the option.
 *
 * The caller must have already applied the font, size and characterSpacing,
 * since widthOfString measures against the current state.
 */
export function fitText(doc, text, maxWidth, { characterSpacing = 0 } = {}) {
  const str = String(text ?? '');
  if (str.length === 0) return '';
  if (doc.widthOfString(str, { characterSpacing }) <= maxWidth) return str;

  const ellipsis = '…';
  const budget = maxWidth - doc.widthOfString(ellipsis, { characterSpacing });
  if (budget <= 0) return ellipsis;

  // Linear scan from the end. These strings are tens of characters, not
  // thousands, so a binary search would be complexity for no measurable win.
  let cut = str.length;
  while (cut > 0 && doc.widthOfString(str.slice(0, cut), { characterSpacing }) > budget) cut -= 1;
  return `${str.slice(0, cut).trimEnd()}${ellipsis}`;
}

/**
 * The navy banner every document opens with. Returns the y coordinate
 * content should start at, so callers never hardcode an offset that would
 * silently overlap if the masthead height changed.
 *
 * Drawn from x=0 to the full page width (not inset to the margin) so it
 * reads as a bound edge of the page rather than a floating box.
 */
export function drawMasthead(doc, { churchName, documentTitle, subtitle, metaLines = [] }) {
  const { width } = doc.page;
  const left = doc.page.margins.left;
  const contentWidth = width - left - doc.page.margins.right;

  doc.rect(0, 0, width, MASTHEAD_HEIGHT).fill(PALETTE.navy);
  doc.rect(0, MASTHEAD_HEIGHT, width, ACCENT_RULE_HEIGHT).fill(PALETTE.green);

  // Church name: uppercase with 0.05em tracking. Capped at 62% of the
  // content width and ellipsised, so a long church name can never run into
  // the right-hand metadata block.
  // Each masthead string is measured and truncated to ONE line (fitText)
  // before it is drawn. The band has three stacked rows at fixed y offsets
  // (20 / 44 / 58), so anything that wrapped would land on top of the row
  // below it.
  const headWidth = contentWidth * 0.62;

  const nameSize = 15;
  const nameTracking = trackingFor(nameSize);
  doc.fillColor(PALETTE.onNavy).font('Helvetica-Bold').fontSize(nameSize);
  doc.text(fitText(doc, String(churchName ?? '').toUpperCase(), headWidth, { characterSpacing: nameTracking }), left, 20, {
    lineBreak: false,
    characterSpacing: nameTracking,
  });

  if (documentTitle) {
    const titleSize = 9.5;
    const titleTracking = trackingFor(titleSize, 0.08);
    doc.font('Helvetica').fontSize(titleSize).fillColor(PALETTE.onNavyMuted);
    doc.text(
      fitText(doc, String(documentTitle).toUpperCase(), headWidth, { characterSpacing: titleTracking }),
      left,
      44,
      { lineBreak: false, characterSpacing: titleTracking }
    );
  }
  if (subtitle) {
    doc.font('Helvetica').fontSize(8.5).fillColor(PALETTE.onNavyMuted);
    doc.text(fitText(doc, subtitle, headWidth), left, 58, { lineBreak: false });
  }

  // Right-aligned metadata stack (period, receipt number, workspace slug).
  // Held to the ~35% of the band the head block does not use, so a long
  // value shrinks with an ellipsis instead of running back under the church
  // name.
  const metaWidth = contentWidth * 0.35;
  doc.font('Helvetica').fontSize(8).fillColor(PALETTE.onNavyMuted);
  metaLines.filter(Boolean).forEach((line, i) => {
    doc.text(fitText(doc, line, metaWidth), left + contentWidth - metaWidth, 22 + i * 11, {
      width: metaWidth,
      align: 'right',
      lineBreak: false,
    });
  });

  doc.fillColor(PALETTE.ink);
  return MASTHEAD_HEIGHT + ACCENT_RULE_HEIGHT + 18;
}

/**
 * Label/value pairs in two aligned columns. Replaces the old
 * `text(..., { continued: true })` approach, which let the value start
 * wherever the label happened to end — so no two rows lined up.
 */
export function drawFieldRows(doc, rows, { labelWidth = 150, gap = 10, rowHeight = 16 } = {}) {
  const left = doc.page.margins.left;
  for (const [label, value] of rows) {
    if (value === undefined) continue;
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(PALETTE.muted);
    doc.text(`${label}`, left, y, { width: labelWidth, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(PALETTE.ink);
    const valueWidth = doc.page.width - doc.page.margins.right - left - labelWidth - gap;
    doc.text(fitText(doc, value === null || value === '' ? '—' : String(value), valueWidth), left + labelWidth + gap, y, {
      width: valueWidth,
      lineBreak: false,
    });
    doc.y = y + rowHeight;
  }
}

/** Small uppercase section heading with a hairline beneath it. */
export function drawSectionHeading(doc, text) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PALETTE.muted);
  doc.text(String(text).toUpperCase(), left, y, { characterSpacing: trackingFor(8.5, 0.09), lineBreak: false });
  doc.y = y + 13;
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.75).strokeColor(PALETTE.hairline).stroke();
  doc.y += 8;
  doc.fillColor(PALETTE.ink);
}

// A column is right-aligned when it says so, or when its key reads as money.
// Numbers sharing a right edge is what makes a decimal column scannable;
// centred or left-aligned figures are the single biggest legibility loss in
// a financial table.
export const isMoneyColumn = (col) =>
  col.align === 'right' || /amount|total|balance|debit|credit|kiasi|jumla/i.test(col.key ?? '');

/**
 * Zebra-banded table with a navy header strip.
 *
 * `columns` are `{ key, header, width?, align? }`. Widths are proportional
 * weights, not points — they are normalised against the available content
 * width so the same column set works on portrait and landscape pages.
 */
export function drawTable(doc, { columns, rows, formatCell = (v) => (v == null ? '' : String(v)) }) {
  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - left - doc.page.margins.right;
  const rowHeight = 17;
  const cellPad = 6;

  const totalWeight = columns.reduce((sum, c) => sum + (c.width ?? 1), 0);
  const widths = columns.map((c) => ((c.width ?? 1) / totalWeight) * contentWidth);
  // Running x offset of each column: the first starts at 0, each subsequent
  // one after the sum of every width before it.
  const offsets = [];
  widths.reduce((x, w, i) => {
    offsets[i] = x;
    return x + w;
  }, 0);

  const drawHeader = () => {
    const y = doc.y;
    doc.rect(left, y - 3, contentWidth, rowHeight + 1).fill(PALETTE.navy);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(PALETTE.onNavy);
    columns.forEach((col, i) => {
      doc.text(String(col.header ?? '').toUpperCase(), left + offsets[i] + cellPad, y + 1, {
        width: widths[i] - cellPad * 2,
        ellipsis: true,
        lineBreak: false,
        align: isMoneyColumn(col) ? 'right' : 'left',
        characterSpacing: trackingFor(8, 0.06),
      });
    });
    doc.y = y + rowHeight + 1;
    doc.fillColor(PALETTE.ink);
  };

  drawHeader();

  rows.forEach((row, index) => {
    // Break before drawing, not after, so a row is never split across the
    // page boundary — and repeat the header on the new page.
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      drawHeader();
    }
    const y = doc.y;
    if (index % 2 === 1) doc.rect(left, y - 3, contentWidth, rowHeight).fill(PALETTE.zebra);
    doc.font('Helvetica').fontSize(9).fillColor(PALETTE.ink);
    columns.forEach((col, i) => {
      const cellWidth = widths[i] - cellPad * 2;
      doc.text(fitText(doc, formatCell(row[col.key], col), cellWidth), left + offsets[i] + cellPad, y, {
        width: cellWidth,
        lineBreak: false,
        align: isMoneyColumn(col) ? 'right' : 'left',
      });
    });
    doc.y = y + rowHeight;
  });

  return { left, contentWidth, widths, offsets, cellPad };
}

/**
 * The closing total: a green DOUBLE rule above the figure, which is the
 * accounting convention for "this is the final sum, nothing follows it".
 * A single hairline reads as just another row separator.
 */
export function drawGrandTotal(doc, label, value, { align = 'right' } = {}) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  doc.y += 4;
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1.2).strokeColor(PALETTE.green).stroke();
  doc.y += 2.5;
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.6).strokeColor(PALETTE.green).stroke();
  doc.y += 7;

  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(PALETTE.navy);
  doc.text(String(label).toUpperCase(), left, y, {
    width: (right - left) / 2,
    characterSpacing: trackingFor(11.5, 0.04),
    lineBreak: false,
  });
  doc.fillColor(PALETTE.green);
  doc.text(String(value), left + (right - left) / 2, y, { width: (right - left) / 2, align, lineBreak: false });
  doc.y = y + 20;
  doc.fillColor(PALETTE.ink);
}

/**
 * Footer rule + muted caption, pinned to the bottom margin of the CURRENT
 * page. Callers pass the generated-on line; nothing else belongs here.
 */
export function drawFooter(doc, text) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.page.height - doc.page.margins.bottom - 16;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(PALETTE.hairline).stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor(PALETTE.muted);
  doc.text(text, left, y + 5, { width: right - left, lineBreak: false });
  doc.fillColor(PALETTE.ink);
}
