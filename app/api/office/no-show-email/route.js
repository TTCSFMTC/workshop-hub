import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { sendNoShowEmail } from "@/lib/resend";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Backs the one-click "Customer no-show" button on a booking.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.to) return NextResponse.json({ error: "to is required" }, { status: 400 });

  try {
    await sendNoShowEmail({ to: body.to, business: body.business, customerName: body.customerName });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("no-show email failed", e);
    return NextResponse.json({ error: "Failed to send — check server logs" }, { status: 500 });
  }
}
