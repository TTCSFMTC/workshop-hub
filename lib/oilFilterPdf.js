import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Weekly oil filter order sheet — A4 portrait, one row per registration with a
// tick box to cross off as each filter is ordered, and a "to order" roll-up by
// filter at the top.
const PAGE = [595, 842];
const LEFT = 36;
const RIGHT = 559;
const TOP = 800;
const BOTTOM = 56;
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.4, 0.4, 0.4);
const RED = rgb(0.75, 0.1, 0.1);

// Helvetica (WinAnsi) can't draw every character; swap anything it can't for "?".
const clean = (v) => String(v ?? "").replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…€]/g, "?");
const fmtD = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const oilFilterRangeLabel = (start, end) => `${fmtD(start)} to ${fmtD(end)}`;

export async function generateOilFilterPdf({ start, end, rows, totals, generatedAt = new Date() }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage(PAGE);
  let y = TOP;

  const fit = (text, f, size, maxWidth) => {
    let out = clean(text);
    if (f.widthOfTextAtSize(out, size) <= maxWidth) return out;
    while (out.length > 1 && f.widthOfTextAtSize(`${out}...`, size) > maxWidth) out = out.slice(0, -1);
    return `${out}...`;
  };
  const text = (t, x, yy, { size = 10, f = font, color = BLACK, width } = {}) =>
    page.drawText(width ? fit(t, f, size, width) : clean(t), { x, y: yy, size, font: f, color });
  const newPage = () => { page = doc.addPage(PAGE); y = TOP; };

  text("Oil filters to order", LEFT, y, { size: 24, f: bold });
  y -= 24;
  text(oilFilterRangeLabel(start, end), LEFT, y, { size: 14, f: bold });
  y -= 16;
  text(`${rows.length} job${rows.length === 1 ? "" : "s"} coming in. Runs to the Monday so we're covered if the delivery is late.`, LEFT, y, { size: 9.5, color: GREY });
  y -= 13;
  text(`Printed ${generatedAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}`, LEFT, y, { size: 9, color: GREY });
  y -= 28;

  // ---- To order, by filter
  text("TO ORDER", LEFT, y, { size: 11, f: bold });
  y -= 6;
  const sumCols = [["Oil filter", LEFT, 250], ["Part no.", LEFT + 255, 100], ["Need", LEFT + 360, 40], ["In stock", LEFT + 405, 48], ["Order", LEFT + 458, 40]];
  const headRow = (cols) => {
    page.drawLine({ start: { x: LEFT, y: y - 2 }, end: { x: RIGHT, y: y - 2 }, thickness: 1.5, color: BLACK });
    y -= 14;
    cols.forEach(([label, x]) => text(label.toUpperCase(), x, y, { size: 8, f: bold, color: GREY }));
    y -= 6;
    page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.6, color: GREY });
    y -= 17;
  };
  if (totals.length === 0) {
    y -= 14;
    text("No oil filters needed for the jobs in this period.", LEFT, y, { size: 11, color: GREY });
    y -= 28;
  } else {
    headRow(sumCols);
    for (const t of totals) {
      if (y < BOTTOM + 30) { newPage(); headRow(sumCols); }
      text(t.name, sumCols[0][1], y, { size: 12, f: bold, width: sumCols[0][2] });
      text(t.partNumber || "-", sumCols[1][1], y, { size: 11, width: sumCols[1][2] });
      text(String(t.need), sumCols[2][1], y, { size: 12 });
      text(String(t.stock), sumCols[3][1], y, { size: 11, color: GREY });
      text(t.toOrder > 0 ? String(t.toOrder) : "OK", sumCols[4][1], y, { size: 13, f: bold, color: t.toOrder > 0 ? RED : GREY });
      y -= 22;
    }
    y -= 14;
  }

  // ---- By registration
  if (y < BOTTOM + 80) newPage();
  text("BY REGISTRATION", LEFT, y, { size: 11, f: bold });
  y -= 6;
  const cols = [["", LEFT, 16], ["Date", LEFT + 22, 60], ["Reg", LEFT + 86, 70], ["Car / job", LEFT + 160, 150], ["Oil filter", LEFT + 315, 130], ["Part no.", LEFT + 450, 73]];
  headRow(cols);
  if (rows.length === 0) {
    text("Nothing booked in for this period yet.", LEFT, y, { size: 11, color: GREY });
  }
  for (const r of rows) {
    if (y < BOTTOM + 14) { newPage(); headRow(cols); }
    const noFilter = r.filters.length === 0;
    page.drawRectangle({ x: LEFT, y: y - 3, width: 13, height: 13, borderColor: BLACK, borderWidth: 1 });
    text(fmtD(r.date), cols[1][1], y, { size: 10, width: cols[1][2] });
    text(r.reg, cols[2][1], y, { size: 12, f: bold, width: cols[2][2] });
    text(r.vehicle, cols[3][1], y, { size: 10, width: cols[3][2] });
    text(r.job, cols[3][1], y - 11, { size: 8, color: GREY, width: cols[3][2] });
    if (noFilter) {
      text("NO OIL FILTER SET - CHECK", cols[4][1], y, { size: 9, f: bold, color: RED, width: 190 });
    } else {
      r.filters.forEach((f, i) => {
        const yy = y - i * 11;
        text(`${f.qty > 1 ? `${f.qty}x ` : ""}${f.name}`, cols[4][1], yy, { size: 9.5, f: bold, width: cols[4][2] });
        text(f.partNumber || "-", cols[5][1], yy, { size: 9.5, width: cols[5][2] });
      });
    }
    y -= Math.max(30, 20 + Math.max(0, r.filters.length - 1) * 11);
    page.drawLine({ start: { x: LEFT, y: y + 17 }, end: { x: RIGHT, y: y + 17 }, thickness: 0.4, color: rgb(0.8, 0.8, 0.8) });
  }

  // Page footers
  doc.getPages().forEach((p, i, all) => {
    p.drawText(clean(`Warrington 4x4 / Timing Chain Specialists  -  Oil filters ${oilFilterRangeLabel(start, end)}  -  page ${i + 1} of ${all.length}`), { x: LEFT, y: 28, size: 8, font, color: GREY });
  });
  return doc.save();
}
