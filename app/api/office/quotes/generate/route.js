import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { extractQuoteFromScript } from "@/lib/anthropic";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Subtotal/VAT/total are always derived here from the line items rather
// than trusted from whatever the model reported — keeps the numbers
// internally consistent even if the source script's own arithmetic was off,
// and matches however office ends up editing individual lines afterwards.
function computeTotals(lineItems, vatRate) {
  const subtotal = lineItems.reduce((sum, l) => sum + (l.quantity || 1) * (l.unit_price || 0), 0);
  const roundedSubtotal = Math.round(subtotal * 100) / 100;
  const vat = Math.round(roundedSubtotal * (vatRate / 100) * 100) / 100;
  return { subtotal: roundedSubtotal, vat, total: Math.round((roundedSubtotal + vat) * 100) / 100 };
}

// Accepts pasted "script" text — the reply from a Claude/ChatGPT
// conversation drafting a repair quote for a customer who hasn't booked in
// yet — extracts a structured quote (customer/vehicle, parts, labour), and
// files it as a needs_review row in the Quotes tab. Nothing touches Zoho
// here; that only happens once office confirms it and posts it.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const scriptText = (body?.scriptText || "").trim();
  if (!scriptText) return NextResponse.json({ error: "scriptText is required" }, { status: 400 });

  const business = body?.business === "Timing Chain Specialists" ? "Timing Chain Specialists" : "Warrington 4x4";

  let extracted;
  try {
    extracted = await extractQuoteFromScript({ scriptText });
  } catch (extractError) {
    console.error("quote extraction failed", extractError);
    return NextResponse.json({ error: "Couldn't read that script — try again, or check it actually contains a priced quote" }, { status: 500 });
  }

  const lineItems = (extracted.line_items || []).map((l) => ({
    type: l.type === "labour" ? "labour" : "part",
    description: l.description || "",
    quantity: l.quantity || 1,
    unit_price: l.unit_price ?? 0,
    amount: Math.round((l.quantity || 1) * (l.unit_price ?? 0) * 100) / 100,
  }));

  if (lineItems.length === 0) {
    return NextResponse.json({ error: "No priced parts or labour found in that script" }, { status: 400 });
  }

  const vatRate = extracted.vat_rate ?? 20;
  const { subtotal, vat, total } = computeTotals(lineItems, vatRate);

  const { data, error } = await supabaseAdmin.from("quotes").insert({
    business,
    customer_name: extracted.customer_name || null,
    customer_email: extracted.customer_email || null,
    customer_phone: extracted.customer_phone || null,
    vehicle_description: extracted.vehicle || null,
    source_script: scriptText,
    line_items: lineItems,
    subtotal,
    vat_rate: vatRate,
    vat,
    total,
    notes: extracted.notes || null,
  }).select("id").single();

  if (error) {
    console.error("quote insert failed", error);
    return NextResponse.json({ error: "Failed to save quote — check server logs" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
