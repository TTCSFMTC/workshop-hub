import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { generateApprovalWriteup } from "@/lib/anthropic";
import { sendApprovalEmail } from "@/lib/resend";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Office reviews a technician-flagged "extra work" item, sets the price and
// whether it can be done while the vehicle's still in, then this generates
// the AI write-up and emails the customer their approval link — never
// automatic, a human in the office always decides when it's ready to send.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const { approvalId, price, inStock } = body;
  if (!approvalId || !price) return NextResponse.json({ error: "approvalId and price are required" }, { status: 400 });

  const { data: approval, error: e1 } = await supabase.from("job_approvals").select("*").eq("id", approvalId).maybeSingle();
  if (e1 || !approval) return NextResponse.json({ error: "Approval not found" }, { status: 404 });

  const { data: card, error: e2 } = await supabase.from("job_cards").select("*").eq("id", approval.job_card_id).maybeSingle();
  if (e2 || !card) return NextResponse.json({ error: "Job card not found" }, { status: 404 });

  const { data: booking, error: e4 } = await supabase.from("bookings").select("job_type_id, business, email").eq("id", approval.booking_id).maybeSingle();
  if (e4 || !booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (!booking.email) return NextResponse.json({ error: "No email on file for this customer — add one to the booking first" }, { status: 400 });

  let jobTypeName = null;
  if (booking.job_type_id) {
    const { data: jobType } = await supabase.from("job_types").select("name").eq("id", booking.job_type_id).maybeSingle();
    jobTypeName = jobType?.name || null;
  }

  try {
    const writeup = await generateApprovalWriteup({
      vehicleReg: card.reg, vehicleModel: card.model, jobTypeName,
      rawNotes: approval.description, price, inStock: !!inStock,
    });

    const approveUrl = `${request.nextUrl.origin}/approve/${approval.token}`;
    await sendApprovalEmail({
      to: booking.email, business: booking.business, customerName: card.customer_name, reg: card.reg, vehicleModel: card.model,
      writeup, price, inStock: !!inStock, approveUrl,
    });

    const sentAt = new Date().toISOString();
    const { error: e3 } = await supabase.from("job_approvals").update({
      ai_writeup: writeup, price, in_stock: !!inStock, status: "sent", sent_at: sentAt,
    }).eq("id", approvalId);
    if (e3) throw e3;

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("send-approval failed", e);
    return NextResponse.json({ error: "Failed to generate or send the approval report — check server logs" }, { status: 500 });
  }
}
