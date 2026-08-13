import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { uploadFileAndShare } from "@/lib/googleDrive";
import { extractInvoiceData } from "@/lib/anthropic";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Matches an extracted vendor name against known suppliers by normalized
// equality (lowercase, punctuation/whitespace stripped) — good enough for
// "OCTANE LTD" vs "Octane Ltd." vs "Octane", not a fuzzy/typo-tolerant
// match. Anything that doesn't match confidently is left for office to
// assign by hand in the review queue rather than risk filing an invoice
// under the wrong supplier.
function normalizeName(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Scans one supplier invoice PDF at a time (the client loops over however
// many were selected, up to ~20) — keeping each request to a single file
// avoids the whole batch timing out on Vercel's function duration limit if
// one PDF is slow to extract.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.filename || !body?.base64) return NextResponse.json({ error: "filename and base64 are required" }, { status: 400 });

  try {
    const buffer = Buffer.from(body.base64, "base64");
    const { id: driveFileId, url: pdfUrl } = await uploadFileAndShare({
      name: body.filename,
      mimeType: "application/pdf",
      buffer,
    });

    let extracted;
    try {
      extracted = await extractInvoiceData({ pdfBase64: body.base64 });
    } catch (extractError) {
      console.error("invoice extraction failed", extractError);
      extracted = {}; // still file it — office can fill fields in by hand rather than losing the upload
    }

    const { data: suppliers, error: supplierError } = await supabaseAdmin.from("suppliers").select("id, name");
    if (supplierError) throw supplierError;
    const vendorNormalized = normalizeName(extracted.vendor_name);
    const matched = vendorNormalized ? suppliers.find((s) => normalizeName(s.name) === vendorNormalized) : null;

    const { data: row, error: insertError } = await supabaseAdmin
      .from("supplier_invoices")
      .insert({
        supplier_id: matched?.id || null,
        pdf_url: pdfUrl,
        pdf_drive_file_id: driveFileId,
        vendor_name_raw: extracted.vendor_name || null,
        invoice_number: extracted.invoice_number || null,
        invoice_date: extracted.invoice_date || null,
        due_date: extracted.due_date || null,
        subtotal: extracted.subtotal ?? null,
        tax: extracted.tax ?? null,
        total: extracted.total ?? 0,
        line_items: extracted.line_items || [],
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    return NextResponse.json({ ok: true, id: row.id, matchedSupplier: matched?.name || null });
  } catch (e) {
    console.error("supplier invoice scan failed", e);
    return NextResponse.json({ error: `Failed to scan ${body.filename} — check server logs` }, { status: 500 });
  }
}
