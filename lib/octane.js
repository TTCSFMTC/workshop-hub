import "server-only";

// Signs in to the user's own Octane Distribution trade account and searches
// for a part, returning the trade-priced listings. Octane sits behind
// Cloudflare (like the other retailer sites parts-finder/ already avoids
// scraping directly) and there's no public API — this is a deliberately
// accepted risk: it may break if Octane changes their login flow or page
// structure, or get rate-limited by their bot protection over time. Session
// cookies are cached in-memory between calls so we don't log in on every
// single search.

const EMAIL = process.env.OCTANE_EMAIL;
const PASSWORD = process.env.OCTANE_PASSWORD;
const BASE = "https://octanedistribution.com";

let cachedCookie = null; // { cookie, expiresAt }

async function login() {
  if (cachedCookie && cachedCookie.expiresAt > Date.now()) return cachedCookie.cookie;

  const res = await fetch(`${BASE}/signin.authenticate.cfm`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD, returnurl: "account.cfm" }),
    redirect: "manual",
  });

  // A successful sign-in redirects (302) to account.cfm; a failed one
  // re-renders the sign-in page with a 200. Either way, collect whatever
  // session cookies came back — they're what actually carries the auth.
  const setCookie = res.headers.get("set-cookie") || "";
  if (!setCookie) throw new Error(`Octane sign-in returned no session cookie (status ${res.status})`);
  const cookie = setCookie.split(",").map((c) => c.split(";")[0]).join("; ");

  cachedCookie = { cookie, expiresAt: Date.now() + 20 * 60 * 1000 }; // re-login every 20 min, session lifetime is unknown
  return cookie;
}

// Pulled straight from the search-results page structure — see the
// <div class="prod-container"><div class="prod-item" data-basket-pn="...">
// <h2>name</h2><h4>part number</h4> ... <span class="price-compact"><strong>
// £NN.NN</strong> markup. Regex rather than a full HTML parser since this
// is the only place in the app that needs to parse HTML, and the structure
// is simple/consistent enough not to warrant a new dependency.
function parseResults(html, limit = 5) {
  const results = [];
  // Prices are rendered as the HTML entity &#163; (£), not a literal £, with
  // whitespace between the price span and the <strong> inside it. A signed-in
  // trade account gets a "price-compact-trade" class (ex VAT) instead of the
  // public "price-compact" (inc VAT) — verified against real fetched
  // responses in both states, not just the browser-rendered DOM.
  const cardRe = /<div class="prod-item[^"]*"\s+data-basket-pn="([^"]*)">[\s\S]*?<h2>([^<]*)<\/h2>\s*<h4>([^<]*)<\/h4>[\s\S]*?class="price-compact[^"]*">\s*<strong>&#163;([\d,.]+)<\/strong>/g;
  let m;
  while ((m = cardRe.exec(html)) && results.length < limit) {
    const [, basketPn, name, partNumber, price] = m;
    results.push({
      partNumber: partNumber.trim() || basketPn.trim(),
      name: name.trim(),
      price: parseFloat(price.replace(/,/g, "")),
      inStock: /class="prod-item instock/.test(m[0]),
    });
  }
  return results;
}

export async function searchOctane(query) {
  if (!EMAIL || !PASSWORD) throw new Error("OCTANE_EMAIL / OCTANE_PASSWORD not configured");
  const cookie = await login();
  const res = await fetch(`${BASE}/search.cfm?q=${encodeURIComponent(query)}`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) throw new Error(`Octane search failed: ${res.status}`);
  const html = await res.text();
  return parseResults(html);
}
