import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// pdf-lib's standard fonts (Helvetica) use WinAnsi encoding, which can only
// represent Latin-1-ish characters — anything outside that (emoji, curly
// "smart" quotes from a phone keyboard, other Unicode symbols) makes
// drawText throw and the whole PDF generation fail. Customers often paste
// their original WhatsApp message straight into symptoms/notes, which
// commonly includes emoji, so every piece of free text drawn onto a page
// goes through this first rather than letting one 🤞 break the confirmation.
const sanitizeForPdf = (text) => String(text ?? "").replace(/[^\x00-\xFF]/g, "");

// Renders the vehicle drop-off confirmation as a one-page PDF — customer
// details, symptoms, the work confirmed, and the signature — for the
// customer's own copy and the workshop's Drive record.
export async function generateIntakePdf({
  customerName, phone, email, reg, vehicleModel, symptoms, workConfirmed, price,
  preScanCompleted, signatureName, signatureDataUrl, confirmedAt,
}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = 800;
  const left = 50;
  const lineGap = 18;

  const draw = (text, { size = 11, useFont = font, color = rgb(0, 0, 0), gap = lineGap } = {}) => {
    page.drawText(sanitizeForPdf(text), { x: left, y, size, font: useFont, color });
    y -= gap;
  };

  draw("Vehicle Drop-off Confirmation", { size: 18, useFont: bold, gap: 26 });
  draw(new Date(confirmedAt).toLocaleString("en-GB"), { size: 10, color: rgb(0.4, 0.4, 0.4), gap: 28 });

  draw("Customer details", { size: 13, useFont: bold, gap: 20 });
  draw(customerName || "—");
  if (phone) draw(phone);
  if (email) draw(email);
  if (reg) draw(reg);
  if (vehicleModel) draw(vehicleModel);
  y -= 10;

  draw("Symptoms", { size: 13, useFont: bold, gap: 20 });
  const symptomLines = wrapText(symptoms || "—", font, 11, 495);
  symptomLines.forEach((line) => draw(line));
  y -= 10;

  draw("Confirmation of work needed", { size: 13, useFont: bold, gap: 20 });
  draw(workConfirmed || "—");
  if (price) draw(`Price: £${Number(price).toFixed(2)}`);
  y -= 10;

  draw(`Pre scan completed: ${preScanCompleted ? "Yes" : "No"}`, { size: 11 });
  y -= 20;

  draw("Customer confirmation", { size: 13, useFont: bold, gap: 20 });
  draw("I confirm the details above are accurate and I authorise the work as discussed.", { size: 10 });
  y -= 10;

  if (signatureDataUrl) {
    const base64 = signatureDataUrl.split(",")[1] || "";
    const pngBytes = Buffer.from(base64, "base64");
    const pngImage = await doc.embedPng(pngBytes);
    const sigHeight = 90;
    const sigWidth = 300;
    page.drawRectangle({ x: left, y: y - sigHeight, width: sigWidth, height: sigHeight, color: rgb(1, 1, 1) });
    page.drawImage(pngImage, { x: left, y: y - sigHeight, width: sigWidth, height: sigHeight });
    y -= sigHeight + 8;
  }
  draw(`Signed: ${signatureName || "—"}`, { size: 11 });

  return doc.save();
}

// Renders the AI-generated technical write-up (diagnosis interpretation +
// findings, tightened for a warranty company or legal review) as a PDF —
// paginates since a full write-up can run past one page, unlike the
// single-page intake confirmation above. Printed and signed by hand (not a
// digital signature pad like the intake confirmation), so the whole
// document is rendered twice into one PDF — an office copy and a customer
// copy, each with its own signature line — one print job produces both.
export async function generateTechnicalWriteupPdf({ customerName, reg, vehicleModel, jobTypeName, writeup, generatedAt }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const left = 50;
  const lineGap = 16;
  const top = 800;
  const bottom = 60;

  const renderCopy = (copyLabel) => {
    let page = doc.addPage([595, 842]); // A4
    let y = top;
    const newPage = () => { page = doc.addPage([595, 842]); y = top; };
    const draw = (text, { size = 11, useFont = font, color = rgb(0, 0, 0), gap = lineGap } = {}) => {
      if (y < bottom) newPage();
      page.drawText(sanitizeForPdf(text), { x: left, y, size, font: useFont, color });
      y -= gap;
    };
    const drawSignatureLine = (label, lineWidth) => {
      if (y < bottom + 40) newPage();
      page.drawLine({ start: { x: left, y }, end: { x: left + lineWidth, y }, thickness: 1, color: rgb(0, 0, 0) });
      y -= 14;
      draw(label, { size: 10, color: rgb(0.4, 0.4, 0.4), gap: lineGap + 12 });
    };

    draw("Technical Diagnosis Write-up", { size: 18, useFont: bold, gap: 22 });
    draw(copyLabel, { size: 10, useFont: bold, color: rgb(0.4, 0.4, 0.4), gap: 20 });
    draw(new Date(generatedAt).toLocaleString("en-GB"), { size: 10, color: rgb(0.4, 0.4, 0.4), gap: 24 });

    draw("Vehicle", { size: 12, useFont: bold, gap: 18 });
    draw(`${vehicleModel || "—"}${reg ? `  ${reg}` : ""}`);
    if (customerName) draw(customerName);
    if (jobTypeName) draw(`Job booked: ${jobTypeName}`);
    y -= 14;

    draw("Findings", { size: 12, useFont: bold, gap: 18 });
    for (const paragraph of (writeup || "").split(/\n+/)) {
      if (!paragraph.trim()) { y -= 6; continue; }
      for (const line of wrapText(paragraph, font, 11, 495)) draw(line);
      y -= 6;
    }

    y -= 24;
    draw("I confirm the findings above have been explained to me.", { size: 10, gap: lineGap + 16 });
    drawSignatureLine("Customer signature", 260);
    drawSignatureLine("Print name", 260);
    drawSignatureLine("Date", 160);
  };

  renderCopy("Office copy");
  renderCopy("Customer copy");

  return doc.save();
}

function wrapText(text, font, size, maxWidth) {
  const words = sanitizeForPdf(text).split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}
