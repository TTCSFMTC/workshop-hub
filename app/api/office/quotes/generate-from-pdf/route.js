import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { extractQuoteFromPdf } from "@/lib/anthropic";
import { normalizeLineItems, computeQuoteTotals } from "@/lib/quotes";
import { uploadFileAndShare } from "@/lib/googleDrive";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Same idea as the pasted-script route, but for an uploaded PDF — a
// supplier's quote, a printed parts/price sheet, whatever office would
// rather upload than retype. The PDF itself is archived to Drive (same
// pattern as Supplier Invoices) so it stays available for reference from
// the quote card.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.filename || !body?.base64) return NextResponse.json({ error: "filename and base64 are required" }, { status: 400 });

  const business = body?.business === "Timing Chain Specialists" ? "Timing Chain Specialists" : "Warrington 4x4";

  try {
    const buffer = Buffer.from(body.base64, "base64");
    const { id: driveFileId, url: pdfUrl } = await uploadFileAndShare({
      name: body.filename,
      mimeType: "application/pdf",
      buffer,
    });

    let extracted;
    try {
      extracted = await extractQuoteFromPdf({ pdfBase64: body.base64 });
    } catch (extractError) {
      console.error("quote PDF extraction failed", extractError);
      return NextResponse.json({ error: `Couldn't read ${body.filename} — try again, or check it actually contains a priced quote` }, { status: 500 });
    }

    const lineItems = normalizeLineItems(extracted.line_items);
    if (lineItems.length === 0) {
      return NextResponse.json({ error: `No priced parts or labour found in ${body.filename}` }, { status: 400 });
    }

    const vatRate = extracted.vat_rate ?? 20;
    const { subtotal, vat, total } = computeQuoteTotals(lineItems, vatRate);

    const { data, error } = await supabaseAdmin.from("quotes").insert({
      business,
      customer_name: extracted.customer_name || null,
      customer_email: extracted.customer_email || null,
      customer_phone: extracted.customer_phone || null,
      vehicle_description: extracted.vehicle || null,
      source_pdf_url: pdfUrl,
      source_pdf_drive_file_id: driveFileId,
      line_items: lineItems,
      subtotal,
      vat_rate: vatRate,
      vat,
      total,
      notes: extracted.notes || null,
    }).select("id").single();

    if (error) throw error;

    return NextResponse.json({ ok: true, id: data.id });
  } catch (e) {
    console.error("quote PDF upload failed", e);
    return NextResponse.json({ error: `Failed to process ${body.filename} — check server logs` }, { status: 500 });
  }
}
