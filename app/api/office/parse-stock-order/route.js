import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { parseStockOrder } from "@/lib/anthropic";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Backs the mic button on the Stock tab's "Add by voice" modal — turns a
// dictated part order into structured fields the modal pre-fills, so office
// can read the details off a box or invoice instead of typing them.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });

  try {
    const parsed = await parseStockOrder({ text: body.text });
    return NextResponse.json(parsed);
  } catch (e) {
    console.error("parse-stock-order failed", e);
    return NextResponse.json({ error: "Failed to parse — check server logs" }, { status: 500 });
  }
}
