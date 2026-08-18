import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio signs every webhook request with HMAC-SHA1 over the full request
// URL plus every POST param (sorted by key, concatenated as key+value with
// no separators), keyed by the account's Auth Token. Verifying this is the
// only thing standing between this route and anyone on the internet who
// finds the URL and starts writing fake stock — there's no session cookie
// here since Twilio's servers aren't logged into the app.
export function verifyTwilioSignature({ url, params, signature, authToken }) {
  if (!signature || !authToken) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  const expected = createHmac("sha1", authToken).update(data, "utf-8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
