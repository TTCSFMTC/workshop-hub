import { NextResponse } from "next/server";
import { PROFIT_SESSION_COOKIE, checkProfitPassword, profitSessionToken } from "@/lib/auth";

export async function POST(request) {
  const { password } = await request.json().catch(() => ({}));

  if (!checkProfitPassword(password)) {
    return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(PROFIT_SESSION_COOKIE, profitSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours — shorter-lived than the main site session on purpose
  });
  return response;
}
