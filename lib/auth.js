import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "wh_session";

// The cookie never holds the plaintext password — it holds an HMAC of it,
// keyed by AUTH_SECRET, so the site password isn't sitting in the browser.
export function sessionToken() {
  return createHmac("sha256", process.env.AUTH_SECRET || "")
    .update(process.env.SITE_PASSWORD || "")
    .digest("hex");
}

export function checkPassword(candidate) {
  const expected = process.env.SITE_PASSWORD || "";
  const a = Buffer.from(candidate || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isValidSession(cookieValue) {
  if (!cookieValue) return false;
  const expected = Buffer.from(sessionToken());
  const actual = Buffer.from(cookieValue);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
