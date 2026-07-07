import { NextResponse } from "next/server";
import { SESSION_COOKIE, checkPassword, sessionToken } from "@/lib/auth";

export async function POST(request) {
  const { password } = await request.json().catch(() => ({}));

  if (!checkPassword(password)) {
    return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
