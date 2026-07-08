import { NextResponse } from "next/server";
import { PROFIT_SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(PROFIT_SESSION_COOKIE);
  return response;
}
