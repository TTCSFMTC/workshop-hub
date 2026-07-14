import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { findOrCreateContact, createInvoice } from "@/lib/zoho";
import { ZOHO_ORG_IDS, REVIEW_LINKS, BANK_DETAILS } from "@/lib/constants";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Creates a Zoho Books invoice for a completed, priced booking. Called by the
// "Create Zoho invoice" button in Office mode — never automatic, since a
// human should always be the one deciding a job is ready to invoice.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const { business, customerName, phone, jobValue, reg, jobTypeName } = body;
  const orgId = ZOHO_ORG_IDS[business];
  if (!orgId) return NextResponse.json({ error: `No Zoho organization configured for "${business}"` }, { status: 400 });
  if (!customerName || !jobValue) return NextResponse.json({ error: "customerName and jobValue are required" }, { status: 400 });

  try {
    const contactId = await findOrCreateContact(orgId, { name: customerName, phone });
    const lineItemName = [jobTypeName, reg].filter(Boolean).join(" — ") || "Workshop job";
    const notes = `Bank transfer details:\n${BANK_DETAILS.accountName}\nSort code: ${BANK_DETAILS.sortCode}\nAccount number: ${BANK_DETAILS.accountNumber}\n\nThank you for your business — we'd really appreciate a quick Google review: ${REVIEW_LINKS[business] || ""}`;
    const invoice = await createInvoice(orgId, { contactId, lineItemName, amount: jobValue, notes });
    return NextResponse.json({
      invoiceId: invoice.invoice_id,
      invoiceNumber: invoice.invoice_number,
      invoiceUrl: invoice.invoice_url,
    });
  } catch (e) {
    console.error("Zoho invoice creation failed", e);
    return NextResponse.json({ error: "Zoho invoice creation failed — check server logs" }, { status: 500 });
  }
}
