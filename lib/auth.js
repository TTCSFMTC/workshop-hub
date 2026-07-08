import { createHmac, timingSafeEqual } from "node:crypto";

// The cookie never holds the plaintext password — it holds an HMAC of it,
// keyed by AUTH_SECRET, so the password isn't sitting in the browser.
// Shared by the main site gate and the Profitability tab's second gate —
// same mechanism, different secret and cookie per gate.
function makeGate(passwordEnvVar) {
  const token = () =>
    createHmac("sha256", process.env.AUTH_SECRET || "")
      .update(process.env[passwordEnvVar] || "")
      .digest("hex");
  const check = (candidate) => {
    const expected = process.env[passwordEnvVar] || "";
    const a = Buffer.from(candidate || "");
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  };
  const isValid = (cookieValue) => {
    if (!cookieValue) return false;
    const expected = Buffer.from(token());
    const actual = Buffer.from(cookieValue);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  };
  return { token, check, isValid };
}

export const SESSION_COOKIE = "wh_session";
const siteGate = makeGate("SITE_PASSWORD");
export const sessionToken = siteGate.token;
export const checkPassword = siteGate.check;
export const isValidSession = siteGate.isValid;

export const PROFIT_SESSION_COOKIE = "wh_profit_session";
const profitGate = makeGate("PROFIT_PASSWORD");
export const profitSessionToken = profitGate.token;
export const checkProfitPassword = profitGate.check;
export const isValidProfitSession = profitGate.isValid;
