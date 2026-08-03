import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Printable "jobs still to finish" sheet — oldest booking first, everything
// the workshop still has physically outstanding (not workshop completed,
// not collected yet). Landscape, since a row this wide would force cramped
// or truncated columns in portrait.
const PAGE_SIZE = [842, 595];
const LEFT = 40;
const TOP = 555;
const BOTTOM = 40;
const COLS = [
  ["dateLabel", "Booked in", 75],
  ["requiredByLabel", "Required by", 75],
  ["customerName", "Customer", 110],
  ["reg", "Reg", 70],
  ["vehicleModel", "Vehicle", 110],
  ["business", "Business", 115],
  ["jobTypeLabel", "Job type", 150],
  ["status", "Status", 60],
];
const TABLE_WIDTH = COLS.reduce((sum, c) => sum + c[2], 0);

export async function generateStillToFinishPdf({ rows, generatedAt }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage(PAGE_SIZE);
  let y = TOP;

  page.drawText("Jobs still to finish", { x: LEFT, y, size: 18, font: bold, color: rgb(0, 0, 0) });
  y -= 18;
  page.drawText(`Printed ${new Date(generatedAt).toLocaleString("en-GB")} — oldest first`, { x: LEFT, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
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
      page.drawText(text, { x, y, size: 8, font, color: rgb(0, 0, 0) });
      x += width;
    }
    y -= 14;
  }

  if (rows.length === 0) {
    page.drawText("Nothing outstanding — every booked job is workshop completed.", { x: LEFT, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
  }

  return doc.save();
}

function truncateToWidth(text, font, size, maxWidth) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}
