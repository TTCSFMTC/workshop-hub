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

// Zoho Books enforces unique contact names AND unique emails per
// organization, and rejects a create for either clash with wording that
// varies ("...already exists", "...already belongs to another contact",
// etc.) — trying to pattern-match every possible message and only then
// search for the existing contact was fragile, and silently failed outright
// for a returning customer whose name came out slightly different the
// second time (a typo, different capitalisation, "Ltd" left off) even
// though their email was the same and already on file: Zoho rejects on the
// email clash, but the old code only ever searched by name to recover, so
// it never found the match and just threw Zoho's raw error — leaving the
// booking with no invoice at all, and so silently missing from the figures.
//
// Searching for an existing match by email first (then by name) sidesteps
// all of that — a returning customer is found straight away, without ever
// needing to attempt a create that's likely to fail.
// Tidies an email typed at the booking desk (stray spaces, a trailing dot or
// comma); returns "" for anything that still isn't a plausible address.
const cleanEmail = (raw) => {
  const e = String(raw || "")
    .trim()
    .replace(/^mailto:/i, "")            // pasted from a mail link
    .replace(/^[^A-Za-z0-9]+/, "")       // stray dash / bracket / quote at the front
    .replace(/[^A-Za-z0-9]+$/, "");      // stray dot / comma / bracket at the end
  return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$/.test(e) ? e : "";
};

export async function findOrCreateContact(orgId, { name, phone, email: rawEmail }) {
  const email = cleanEmail(rawEmail);
  const findByEmail = async () => {
    if (!email) return null;
    const found = await booksFetch(orgId, `/contacts?email=${encodeURIComponent(email)}`);
    return found.data.contacts?.find((c) => (c.email || "").toLowerCase() === email.toLowerCase()) || null;
  };
  const findByName = async () => {
    const found = await booksFetch(orgId, `/contacts?contact_name=${encodeURIComponent(name)}`);
    return found.data.contacts?.find((c) => c.contact_name === name) || null;
  };

  const existing = (await findByEmail()) || (await findByName());
  if (existing) {
    // A customer already in Zoho from an earlier job without an email on
    // file gets the one from this booking added, so invoices can be emailed
    // from Zoho. Never overwrites an email that's already there.
    await ensureContactEmail(orgId, existing, { name, email });
    return existing.contact_id;
  }

  let created = await booksFetch(orgId, "/contacts", {
    method: "POST",
    body: JSON.stringify({ contact_name: name, contact_type: "customer", mobile: phone || "", email: email || "" }),
  });
  // Zoho can still refuse an address that looks fine to us — never let that
  // stop the invoice: create the contact without the email instead.
  if (!created.ok && email && /email/i.test(JSON.stringify(created.data))) {
    created = await booksFetch(orgId, "/contacts", {
      method: "POST",
      body: JSON.stringify({ contact_name: name, contact_type: "customer", mobile: phone || "" }),
    });
  }
  if (created.ok) {
    await ensureContactEmail(orgId, created.data.contact, { name, email });
    return created.data.contact.contact_id;
  }

  // Only reachable if two bookings for the same brand-new customer got
  // invoiced at almost the same moment (a genuine race, not the common
  // case above) — search once more rather than giving up.
  const retry = (await findByEmail()) || (await findByName());
  if (retry) return retry.contact_id;

  throw new Error(`Zoho contact create failed: ${JSON.stringify(created.data)}`);
}

// Makes sure the contact has the booking's email on it. Zoho Books keeps a
// contact's email on its contact person, so if the contact came back without
// one (or the create ignored it), add the email as a contact person — the
// first person on a contact becomes its primary one. (Zoho rejects an
// is_primary_contact field on this call with "Invalid Element".)
// Best-effort only — a failure here must never stop the invoice being raised.
async function ensureContactEmail(orgId, contact, { name, email: rawEmail }) {
  // Tidy common typos from the booking form (stray spaces, a trailing dot or
  // comma) and skip anything that still isn't a valid address.
  const email = cleanEmail(rawEmail);
  if (!email) return;
  try {
    let current = contact?.email || "";
    if (!current && contact?.contact_id) {
      const full = await booksFetch(orgId, `/contacts/${contact.contact_id}`);
      const persons = full.data?.contact?.contact_persons || [];
      current = full.data?.contact?.email || persons.find((p) => p.email)?.email || "";
    }
    if (current) return;
    const added = await booksFetch(orgId, "/contacts/contactpersons", {
      method: "POST",
      body: JSON.stringify({ contact_id: contact.contact_id, first_name: name, email }),
    });
    if (!added.ok) console.error("Zoho: couldn't add email to contact", added.data);
  } catch (e) {
    console.error("Zoho: ensureContactEmail failed", e);
  }
}

// Pulls the invoice back down as Zoho's own rendered PDF (not something we
// build ourselves) — used to merge it with the technical write-up into one
// document for printing.
export async function downloadInvoicePdf(orgId, invoiceId) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/invoices/${invoiceId}?organization_id=${orgId}&accept=pdf`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (!res.ok) throw new Error(`Zoho invoice PDF download failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

// One line item per job type on the booking (e.g. Timing Chain Replacement,
// Piston Cooling Jet Solenoid, VVT Solenoid each priced separately) — never
// broken down further into separate line items per part, but each line's
// own parts list goes into Zoho's description field so it's still visible
// on the invoice. Each line's `amount` is expected to already be the
// ex-VAT rate when taxId is passed — see the caller (zoho-invoice route),
// which reverse-calculates it from the VAT-inclusive price quoted to the
// customer, same as createEstimate already does for Quotes.
export async function createInvoice(orgId, { contactId, lineItems, reference, notes, taxId }) {
  const res = await booksFetch(orgId, "/invoices", {
    method: "POST",
    body: JSON.stringify({
      customer_id: contactId,
      line_items: lineItems.map((l) => ({
        name: l.name, description: l.description || "", rate: l.amount, quantity: 1,
        ...(taxId ? { tax_id: taxId } : {}),
      })),
      reference_number: reference || "",
      notes: notes || "",
    }),
  });
  if (!res.ok) throw new Error(`Zoho invoice create failed: ${JSON.stringify(res.data)}`);
  return res.data.invoice; // includes invoice_id, invoice_number, invoice_url, etc.
}

// Files a reviewed Quotes-tab quote as an Estimate — Zoho Books' term for a
// sales quote sent to a customer for approval, as opposed to an Invoice
// which represents money actually owed. Unlike createInvoice's one-line-
// per-job-type approach, each part/labour line item is sent separately with
// its own tax_id so Zoho computes and shows VAT explicitly.
export async function createEstimate(orgId, { contactId, lineItems, reference, notes, taxId }) {
  const res = await booksFetch(orgId, "/estimates", {
    method: "POST",
    body: JSON.stringify({
      customer_id: contactId,
      line_items: lineItems.map((l) => ({
        name: l.description, rate: l.unit_price, quantity: l.quantity || 1,
        ...(taxId ? { tax_id: taxId } : {}),
      })),
      reference_number: reference || "",
      notes: notes || "",
    }),
  });
  if (!res.ok) throw new Error(`Zoho estimate create failed: ${JSON.stringify(res.data)}`);
  return res.data.estimate; // includes estimate_id, estimate_number, estimate_url, etc.
}
