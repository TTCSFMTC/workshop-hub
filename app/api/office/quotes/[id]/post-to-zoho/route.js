import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { findOrCreateContact, createEstimate } from "@/lib/zoho";
import { ZOHO_ORG_IDS, ZOHO_VAT_TAX_IDS } from "@/lib/constants";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Posts one reviewed quote to Zoho as an Estimate. Called by the "Post to
// Zoho" button in the Quotes tab — never automatic, same as the existing
// "Create Zoho invoice" button on a booking.
export async function POST(request, { params }) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { data: quote, error: fetchError } = await supabaseAdmin.from("quotes").select("*").eq("id", id).maybeSingle();
  if (fetchError || !quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (quote.status === "posted") return NextResponse.json({ error: "Already posted to Zoho" }, { status: 409 });
  if (!quote.customer_name) return NextResponse.json({ error: "No customer name — fix it before posting" }, { status: 400 });
  if (!quote.total || quote.total <= 0) return NextResponse.json({ error: "No total — check the line items" }, { status: 400 });
  if (!(quote.line_items || []).length) return NextResponse.json({ error: "No line items — check the extracted quote" }, { status: 400 });

  const orgId = ZOHO_ORG_IDS[quote.business];
  if (!orgId) return NextResponse.json({ error: `No Zoho organization configured for "${quote.business}"` }, { status: 400 });

  try {
    const contactId = await findOrCreateContact(orgId, {
      name: quote.customer_name, email: quote.customer_email, phone: quote.customer_phone,
    });

    const notesParts = [quote.vehicle_description, quote.notes].filter(Boolean);
    const estimate = await createEstimate(orgId, {
      contactId,
      lineItems: quote.line_items,
      notes: notesParts.join(" — ") || undefined,
      taxId: ZOHO_VAT_TAX_IDS[quote.business],
    });

    const { error: updateError } = await supabaseAdmin.from("quotes").update({
      status: "posted",
      zoho_estimate_id: estimate.estimate_id,
      zoho_estimate_number: estimate.estimate_number,
      zoho_estimate_url: estimate.estimate_url,
      posted_at: new Date().toISOString(),
    }).eq("id", id);
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, estimateId: estimate.estimate_id, estimateNumber: estimate.estimate_number, estimateUrl: estimate.estimate_url });
  } catch (e) {
    console.error("post quote to Zoho failed", e);
    return NextResponse.json({ error: e.message || "Failed to post to Zoho — check server logs" }, { status: 500 });
  }
}
