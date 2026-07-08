import "server-only";
import crypto from "crypto";

// Talks to the Google Calendar REST API directly using a signed service-
// account JWT, rather than pulling in the full `googleapis` SDK for three
// endpoints. Only ever imported from server-side route handlers — the
// `server-only` import above makes that a build error otherwise, since the
// private key must never reach the browser bundle.

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedToken = null; // { token, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claim}`), PRIVATE_KEY);
  const jwt = `${header}.${claim}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

function nextDayISO(dateISO) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function calendarFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  return res;
}

// Creates the event if `googleEventId` is null, otherwise updates the
// existing one. Only ever sends the job type name + colour — no customer
// or vehicle data ever reaches Google.
export async function upsertCalendarEvent({ googleEventId, date, endDate, summary, colorId }) {
  const body = {
    summary: summary || "Booked",
    start: { date },
    end: { date: endDate || nextDayISO(date) },
    ...(colorId ? { colorId } : {}),
  };

  if (googleEventId) {
    const res = await calendarFetch(`/events/${encodeURIComponent(googleEventId)}`, { method: "PATCH", body: JSON.stringify(body) });
    if (res.status === 404 || res.status === 410) {
      // Event was removed on the Google side — fall through and recreate it.
    } else if (!res.ok) {
      throw new Error(`Google Calendar update failed: ${res.status} ${await res.text()}`);
    } else {
      return (await res.json()).id;
    }
  }

  const res = await calendarFetch("/events", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Google Calendar insert failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

export async function deleteCalendarEvent(googleEventId) {
  if (!googleEventId) return;
  const res = await calendarFetch(`/events/${encodeURIComponent(googleEventId)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404 && res.status !== 410 && res.status !== 204) {
    throw new Error(`Google Calendar delete failed: ${res.status} ${await res.text()}`);
  }
}
