import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { findOrCreateVendorContact, createBill } from "@/lib/zoho";
import { ZOHO_ORG_IDS } from "@/lib/constants";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Posts a confirmed supplier invoice to Zoho Books as a Bill — never
// automatic, same "a human decides" rule as the existing customer-invoice
// flow (see app/api/office/zoho-invoice/route.js). Only ever called from
// the "Post to Zoho" button once office has confirmed the supplier and
// checked the extracted figures.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.invoiceId) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 });

  const { data: invoice, error: e1 } = await supabaseAdmin.from("supplier_invoices").select("*").eq("id", body.invoiceId).maybeSingle();
  if (e1 || !invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status === "posted") return NextResponse.json({ error: "This invoice has already been posted to Zoho" }, { status: 409 });
  if (!invoice.supplier_id) return NextResponse.json({ error: "Assign a supplier before posting to Zoho" }, { status: 400 });
  if (!invoice.total || invoice.total <= 0) return NextResponse.json({ error: "This invoice has no total — check the extracted figures" }, { status: 400 });

  const { data: supplier, error: e2 } = await supabaseAdmin.from("suppliers").select("*").eq("id", invoice.supplier_id).maybeSingle();
  if (e2 || !supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

  const orgId = ZOHO_ORG_IDS[invoice.business];
  if (!orgId) return NextResponse.json({ error: `No Zoho organization configured for "${invoice.business}"` }, { status: 400 });

  try {
    const vendorId = await findOrCreateVendorContact(orgId, { name: supplier.name, email: supplier.contact_email, phone: null });
    const lineItems = (invoice.line_items || []).length > 0
      ? invoice.line_items.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unit_price, amount: l.amount }))
      : [{ description: invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : "Purchase", quantity: 1, unitPrice: invoice.total, amount: invoice.total }];

    const bill = await createBill(orgId, {
      vendorId,
      billNumber: invoice.invoice_number,
      date: invoice.invoice_date,
      dueDate: invoice.due_date,
      lineItems,
      notes: invoice.invoice_number ? `Filed from scanned invoice ${invoice.invoice_number}` : "Filed from scanned invoice",
    });

    const { error: e3 } = await supabaseAdmin.from("supplier_invoices").update({
      status: "posted",
      zoho_bill_id: bill.bill_id,
      zoho_bill_number: bill.bill_number,
      confirmed_at: invoice.confirmed_at || new Date().toISOString(),
    }).eq("id", invoice.id);
    if (e3) throw e3;

    return NextResponse.json({ ok: true, billId: bill.bill_id, billNumber: bill.bill_number });
  } catch (e) {
    console.error("post supplier invoice to Zoho failed", e);
    return NextResponse.json({ error: "Failed to post to Zoho — check server logs" }, { status: 500 });
  }
}
