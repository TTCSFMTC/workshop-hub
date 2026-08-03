import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Printable "outstanding parts" sheet — every order placed but not yet
// delivered, soonest due date first, so office can see in one place what's
// still owed and who it's coming from.
const PAGE_SIZE = [595, 842]; // A4 portrait — fewer, narrower columns than the jobs sheet
const LEFT = 40;
const TOP = 780;
const BOTTOM = 40;
const COLS = [
  ["partName", "Part", 170],
  ["qty", "Qty", 40],
  ["price", "Price", 60],
  ["supplier", "Supplier", 110],
  ["orderedLabel", "Ordered", 65],
  ["dueLabel", "Due", 70],
];
const TABLE_WIDTH = COLS.reduce((sum, c) => sum + c[2], 0);

export async function generateOutstandingPartsPdf({ rows, generatedAt }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const red = rgb(0.7, 0.15, 0.12);

  let page = doc.addPage(PAGE_SIZE);
  let y = TOP;

  page.drawText("Outstanding parts", { x: LEFT, y, size: 18, font: bold, color: rgb(0, 0, 0) });
  y -= 18;
  page.drawText(`Printed ${new Date(generatedAt).toLocaleString("en-GB")} — soonest due first`, { x: LEFT, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 24;

  const drawHeaderRow = () => {
    let x = LEFT;
    for (const [, label, width] of COLS) {
      page.drawText(label, { x, y, size: 8, font: bold, color: rgb(0.3, 0.3, 0.3) });
      x += width;
    }
    y -= 4;
    page.drawLine({ start: { x: LEFT, y }, end: { x: LEFT + TABLE_WIDTH, y }, thickness: 1, color: rgb(0, 0, 0) });
    y -= 12;
  };
  drawHeaderRow();

  for (const row of rows) {
    if (y < BOTTOM) {
      page = doc.addPage(PAGE_SIZE);
      y = TOP;
      drawHeaderRow();
    }
    let x = LEFT;
    for (const [key, , width] of COLS) {
      const text = truncateToWidth(String(row[key] ?? ""), font, 8, width - 6);
      page.drawText(text, { x, y, size: 8, font, color: key === "dueLabel" && row.overdue ? red : rgb(0, 0, 0) });
      x += width;
    }
    y -= 14;
  }

  if (rows.length === 0) {
    page.drawText("Nothing on order — everything's been delivered.", { x: LEFT, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
  }

  return doc.save();
}

function truncateToWidth(text, font, size, maxWidth) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}
