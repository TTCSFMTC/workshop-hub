import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { searchOctane } from "@/lib/octane";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.query?.trim()) return NextResponse.json({ error: "query is required" }, { status: 400 });

  try {
    const results = await searchOctane(body.query.trim());
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    console.error("octane-price failed", e);
    return NextResponse.json({ error: "Octane price lookup failed — check server logs", detail: e.message }, { status: 500 });
  }
}
