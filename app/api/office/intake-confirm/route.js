import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { generateIntakePdf } from "@/lib/intakePdf";
import { uploadFileAndShare, shareUploadedFile } from "@/lib/googleDrive";
import { sendIntakeConfirmationEmail } from "@/lib/resend";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Generates the signed PDF, saves it (and the drop-off video, if one was
// uploaded) to the shared "Customer Confirmation" Drive folder, records the
// intake confirmation, marks the booking arrived, and emails the customer
// their copy — all triggered by "Confirm arrival" in the Office IN pop-up.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const { bookingId, preScanCompleted, signatureName, signatureDataUrl, videoFileId } = body;
  if (!bookingId || !signatureName || !signatureDataUrl) {
    return NextResponse.json({ error: "bookingId, signatureName and signatureDataUrl are required" }, { status: 400 });
  }

  const { data: booking, error: e1 } = await supabase.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  if (e1 || !booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  let jobTypeName = null;
  if (booking.job_type_id) {
    const { data: jobType } = await supabase.from("job_types").select("name").eq("id", booking.job_type_id).maybeSingle();
    jobTypeName = jobType?.name || null;
  }

  try {
    const confirmedAt = new Date().toISOString();
    const pdfBytes = await generateIntakePdf({
      customerName: booking.customer_name, phone: booking.phone, email: booking.email, reg: booking.reg,
      vehicleModel: booking.vehicle_model, symptoms: booking.symptoms, workConfirmed: jobTypeName, price: booking.job_value,
      preScanCompleted: !!preScanCompleted, signatureName, signatureDataUrl, confirmedAt,
    });
    const { url: pdfUrl } = await uploadFileAndShare({
      name: `${booking.reg || booking.customer_name || "confirmation"} - drop-off confirmation.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(pdfBytes),
    });

    const videoUrl = videoFileId ? await shareUploadedFile(videoFileId) : null;

    const { error: e2 } = await supabase.from("intake_confirmations").insert({
      id: `ic_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      booking_id: bookingId,
      pre_scan_completed: !!preScanCompleted,
      signature: signatureDataUrl,
      signature_name: signatureName,
      pdf_url: pdfUrl,
      video_url: videoUrl,
    });
    if (e2) throw e2;

    const { error: e3 } = await supabase.from("bookings").update({ arrived: true, arrived_at: confirmedAt }).eq("id", bookingId);
    if (e3) throw e3;

    if (booking.email) {
      await sendIntakeConfirmationEmail({
        to: booking.email, business: booking.business, customerName: booking.customer_name, reg: booking.reg, pdfUrl, videoUrl,
      });
    }

    return NextResponse.json({ ok: true, pdfUrl, videoUrl });
  } catch (e) {
    console.error("intake-confirm failed", e);
    return NextResponse.json({ error: "Failed to save the drop-off confirmation — check server logs" }, { status: 500 });
  }
}
