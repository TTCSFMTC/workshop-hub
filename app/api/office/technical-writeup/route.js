import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { generateTechnicalWriteup } from "@/lib/anthropic";
import { generateTechnicalWriteupPdf } from "@/lib/intakePdf";
import { uploadFileAndShare } from "@/lib/googleDrive";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Turns a job card's technician interpretation + diagnosis findings into a
// concise AI-written technical report and saves it to the shared Drive
// folder — for warranty companies or legal review. Deliberately does not
// simplify or soften anything (see lib/anthropic.js), unlike the customer
// approval write-up, and isn't emailed anywhere automatically — office
// downloads the link and sends it wherever the claim needs it to go.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.jobCardId) return NextResponse.json({ error: "jobCardId is required" }, { status: 400 });

  const { data: card, error: e1 } = await supabase.from("job_cards").select("*").eq("id", body.jobCardId).maybeSingle();
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
    const vehicleModel = [card.make, card.model].filter(Boolean).join(" ");
    const writeup = await generateTechnicalWriteup({
      vehicleReg: card.reg, vehicleModel, jobTypeName,
      symptoms: card.symptoms, technicianInterpretation: card.technician_interpretation, diagnosisFindings: card.diagnosis_findings,
    });

    const generatedAt = new Date().toISOString();
    const pdfBytes = await generateTechnicalWriteupPdf({
      customerName: card.customer_name, reg: card.reg, vehicleModel, jobTypeName, writeup, generatedAt,
    });
    const pdfUrl = await uploadFileAndShare({
      name: `${card.reg || card.customer_name || "vehicle"} - technical write-up.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(pdfBytes),
    });

    return NextResponse.json({ ok: true, pdfUrl });
  } catch (e) {
    console.error("technical-writeup failed", e);
    return NextResponse.json({ error: "Failed to generate the technical write-up — check server logs" }, { status: 500 });
  }
}
