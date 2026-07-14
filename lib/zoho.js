import "server-only";

// Talks to the Zoho Books REST API directly using a long-lived refresh
// token (obtained once via a Self Client OAuth grant — see the migration
// notes). Only ever imported from server-side route handlers, same
// server-only guard as lib/googleCalendar.js.

const DC = process.env.ZOHO_DC || "com";
const CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ACCOUNTS_BASE = `https://accounts.zoho.${DC}`;
const API_BASE = `https://www.zohoapis.${DC}/books/v3`;

let cachedToken = null; // { token, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const res = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
    }),
  });
  if (!res.ok) throw new Error(`Zoho auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error(`Zoho auth failed: ${JSON.stringify(data)}`);
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function booksFetch(orgId, path, options = {}) {
  const token = await getAccessToken();
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API_BASE}${path}${sep}organization_id=${orgId}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Zoho Books enforces unique contact names per organization — so this tries
// to create one, and on a "duplicate name" response falls back to finding
// the existing contact with that exact name, rather than tracking a mapping
// table of our own.
export async function findOrCreateContact(orgId, { name, phone, email }) {
  const created = await booksFetch(orgId, "/contacts", {
    method: "POST",
    body: JSON.stringify({ contact_name: name, contact_type: "customer", mobile: phone || "", email: email || "" }),
  });
  if (created.ok) return created.data.contact.contact_id;

  const isDuplicate = created.status === 400 && /already exists|duplicate/i.test(created.data.message || "");
  if (!isDuplicate) throw new Error(`Zoho contact create failed: ${JSON.stringify(created.data)}`);

  const found = await booksFetch(orgId, `/contacts?contact_name=${encodeURIComponent(name)}`);
  const match = found.data.contacts?.find((c) => c.contact_name === name);
  if (!match) throw new Error(`Zoho reported "${name}" as a duplicate contact but it couldn't be found`);
  return match.contact_id;
}

export async function createInvoice(orgId, { contactId, lineItemName, amount, notes }) {
  const res = await booksFetch(orgId, "/invoices", {
    method: "POST",
    body: JSON.stringify({
      customer_id: contactId,
      line_items: [{ name: lineItemName, rate: amount, quantity: 1 }],
      notes: notes || "",
    }),
  });
  if (!res.ok) throw new Error(`Zoho invoice create failed: ${JSON.stringify(res.data)}`);
  return res.data.invoice; // includes invoice_id, invoice_number, invoice_url, etc.
}
