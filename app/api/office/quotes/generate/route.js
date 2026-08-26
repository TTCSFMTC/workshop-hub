import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { extractQuoteFromScript } from "@/lib/anthropic";
import { normalizeLineItems, computeQuoteTotals } from "@/lib/quotes";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
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

  const lineItems = normalizeLineItems(extracted.line_items);
  if (lineItems.length === 0) {
    return NextResponse.json({ error: "No priced parts or labour found in that script" }, { status: 400 });
  }

  const vatRate = extracted.vat_rate ?? 20;
  const { subtotal, vat, total } = computeQuoteTotals(lineItems, vatRate);

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
