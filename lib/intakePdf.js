import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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
    page.drawText(text, { x: left, y, size, font: useFont, color });
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

function wrapText(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
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
