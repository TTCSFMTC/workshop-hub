import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { sendApprovalResponseNotification } from "@/lib/resend";

// Public, unauthenticated route — the random token itself is what scopes
// access to exactly one approval record, same pattern as a password-reset
// link. Never exposes the technician's raw notes, only the AI write-up and
// the fields a customer needs to make a decision.
export async function GET(request, { params }) {
  const { token } = await params;
  const { data: approval, error } = await supabase.from("job_approvals").select("*").eq("token", token).maybeSingle();
  if (error || !approval) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: card } = await supabase.from("job_cards").select("reg, model, customer_name, business").eq("id", approval.job_card_id).maybeSingle();

  return NextResponse.json({
    status: approval.status,
    aiWriteup: approval.ai_writeup,
    price: approval.price,
    inStock: approval.in_stock,
    reg: card?.reg || "",
    vehicleModel: card?.model || "",
    customerName: card?.customer_name || "",
    business: card?.business || "",
    respondedAt: approval.responded_at,
    customerSignatureName: approval.customer_signature_name,
  });
}

export async function POST(request, { params }) {
  const { token } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const { decision, signatureName, signatureDataUrl } = body;
  if (!["approved", "declined"].includes(decision)) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  if (!signatureName?.trim()) return NextResponse.json({ error: "Printed name is required" }, { status: 400 });
  if (decision === "approved" && !signatureDataUrl) return NextResponse.json({ error: "Signature is required to approve" }, { status: 400 });

  const { data: approval, error: e1 } = await supabase.from("job_approvals").select("id, status, job_card_id, price").eq("token", token).maybeSingle();
  if (e1 || !approval) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (approval.status !== "sent") return NextResponse.json({ error: "This request has already been responded to" }, { status: 409 });

  const { error: e2 } = await supabase.from("job_approvals").update({
    status: decision,
    responded_at: new Date().toISOString(),
    customer_signature: signatureDataUrl || null,
    customer_signature_name: signatureName.trim(),
  }).eq("id", approval.id);
  if (e2) return NextResponse.json({ error: "Failed to save your response" }, { status: 500 });

  const { data: card } = await supabase.from("job_cards").select("reg, make, model, customer_name, business").eq("id", approval.job_card_id).maybeSingle();
  try {
    await sendApprovalResponseNotification({
      business: card?.business, customerName: card?.customer_name, reg: card?.reg,
      vehicleModel: [card?.make, card?.model].filter(Boolean).join(" "),
      decision, price: approval.price, signatureName: signatureName.trim(),
    });
  } catch (e) {
    // The customer's decision is already saved — a notification failure
    // shouldn't turn into an error for the customer, just get logged.
    console.error("approval response notification failed", e);
  }

  return NextResponse.json({ ok: true });
}
