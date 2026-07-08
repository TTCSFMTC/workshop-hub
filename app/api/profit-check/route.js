import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PROFIT_SESSION_COOKIE, isValidProfitSession } from "@/lib/auth";

// The cookie is httpOnly, so the client can't read it directly to decide
// whether to show the password form or the report — it asks here instead.
export async function GET() {
  const store = await cookies();
  const authenticated = isValidProfitSession(store.get(PROFIT_SESSION_COOKIE)?.value);
  return NextResponse.json({ authenticated });
}
