import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { sendMissingInvoicesEmail } from "@/lib/resend";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Sends the "please send your invoices" chase email from the Missing
// Invoices section of the Supplier Invoices tab.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.to || !Array.isArray(body.items)) return NextResponse.json({ error: "to and items are required" }, { status: 400 });

  try {
    await sendMissingInvoicesEmail({ to: body.to, supplierName: body.supplierName, items: body.items });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("send missing invoices email failed", e);
    return NextResponse.json({ error: "Failed to send the email — check server logs" }, { status: 500 });
  }
}
