import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PDFDocument } from "pdf-lib";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { downloadInvoicePdf } from "@/lib/zoho";
import { downloadFile } from "@/lib/googleDrive";
import { ZOHO_ORG_IDS } from "@/lib/constants";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Combines Zoho's own rendered invoice PDF with the technician's
// already-generated technical write-up into one PDF — opened directly in a
// new tab by the "Print invoice + write-up together" button on the job
// card, so office gets one print job instead of two separate documents.
export async function GET(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bookingId = new URL(request.url).searchParams.get("bookingId");
  if (!bookingId) return NextResponse.json({ error: "bookingId is required" }, { status: 400 });

  const { data: booking, error: e1 } = await supabase.from("bookings").select("id, business, zoho_invoice_id").eq("id", bookingId).maybeSingle();
  if (e1 || !booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (!booking.zoho_invoice_id) return NextResponse.json({ error: "This booking hasn't been invoiced yet" }, { status: 400 });

  const orgId = ZOHO_ORG_IDS[booking.business];
  if (!orgId) return NextResponse.json({ error: `No Zoho organization configured for "${booking.business}"` }, { status: 400 });

  const { data: jobCard } = await supabase.from("job_cards").select("technical_writeup_drive_file_id").eq("booking_id", bookingId).maybeSingle();
  if (!jobCard?.technical_writeup_drive_file_id) return NextResponse.json({ error: "No technical write-up has been generated for this job yet" }, { status: 400 });

  try {
    const [invoicePdf, writeupPdf] = await Promise.all([
      downloadInvoicePdf(orgId, booking.zoho_invoice_id),
      downloadFile(jobCard.technical_writeup_drive_file_id),
    ]);

    const merged = await PDFDocument.create();
    for (const bytes of [invoicePdf, writeupPdf]) {
      const doc = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
    const mergedBytes = await merged.save();

    return new NextResponse(mergedBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="invoice-and-writeup-${bookingId}.pdf"`,
      },
    });
  } catch (e) {
    console.error("invoice-with-writeup failed", e);
    return NextResponse.json({ error: "Failed to combine the invoice and technical write-up — check server logs" }, { status: 500 });
  }
}
