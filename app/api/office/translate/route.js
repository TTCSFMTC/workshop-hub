import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { translateToEnglish } from "@/lib/anthropic";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Backs the "Convert to English" button on DictateField — a technician
// dictates in Albanian, then converts the box's text to English in place
// rather than needing to redictate or retype it.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });

  try {
    const translated = await translateToEnglish({ text: body.text });
    return NextResponse.json({ translated });
  } catch (e) {
    console.error("translate failed", e);
    return NextResponse.json({ error: "Failed to translate — check server logs" }, { status: 500 });
  }
}
