import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { generateHandoverPdf } from "@/lib/intakePdf";
import { uploadFileAndShare } from "@/lib/googleDrive";
import { sendHandoverConfirmationEmail } from "@/lib/resend";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Generates the signed handover/collection PDF, saves it to the shared
// Drive folder, records the signature on the job card, and emails the
// customer their copy — the legal acknowledgement that they've inspected
// the vehicle and are happy with the work and its condition, taken at
// collection. Mirrors app/api/office/intake-confirm/route.js at the other
// end of the job.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const { jobCardId, signatureName, signatureDataUrl } = body;
  if (!jobCardId || !signatureName || !signatureDataUrl) {
    return NextResponse.json({ error: "jobCardId, signatureName and signatureDataUrl are required" }, { status: 400 });
  }

  const { data: card, error: e1 } = await supabase.from("job_cards").select("*").eq("id", jobCardId).maybeSingle();
  if (e1 || !card) return NextResponse.json({ error: "Job card not found" }, { status: 404 });

  let jobTypeName = null;
  if (card.booking_id) {
    const { data: booking } = await supabase.from("bookings").select("job_type_id").eq("id", card.booking_id).maybeSingle();
    if (booking?.job_type_id) {
      const { data: jobType } = await supabase.from("job_types").select("name").eq("id", booking.job_type_id).maybeSingle();
      jobTypeName = jobType?.name || null;
    }
  }

  try {
    const confirmedAt = new Date().toISOString();
    const vehicleModel = [card.make, card.model].filter(Boolean).join(" ");
    const pdfBytes = await generateHandoverPdf({
      customerName: card.customer_name, reg: card.reg, vehicleModel, jobTypeName,
      signatureName, signatureDataUrl, confirmedAt,
    });
    const { url: pdfUrl } = await uploadFileAndShare({
      name: `${card.reg || card.customer_name || "vehicle"} - handover confirmation.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(pdfBytes),
    });

    const { error: e2 } = await supabase.from("job_cards").update({
      signature: signatureDataUrl, signature_name: signatureName, signature_date: confirmedAt, handover_pdf_url: pdfUrl,
    }).eq("id", card.id);
    if (e2) throw e2;

    // The confirmation itself is already saved by this point — a failed
    // email to the customer is worth logging, but must never make a
    // successful save look like it failed (see intake-confirm for the same
    // reasoning).
    if (card.email) {
      try {
        await sendHandoverConfirmationEmail({
          to: card.email, business: card.business, customerName: card.customer_name, reg: card.reg, pdfUrl,
        });
      } catch (emailError) {
        console.error("handover confirmation email failed", emailError);
      }
    }

    return NextResponse.json({ ok: true, pdfUrl });
  } catch (e) {
    console.error("handover-confirm failed", e);
    return NextResponse.json({ error: "Failed to save the handover confirmation — check server logs" }, { status: 500 });
  }
}
