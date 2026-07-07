import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "./lib/auth";

export function proxy(request) {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (isValidSession(cookie)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!login|api/login|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon).*)",
  ],
};
