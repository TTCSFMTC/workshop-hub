import "server-only";
import crypto from "crypto";

// Talks to the Google Drive REST API authenticated as the actual Google
// account (via a long-lived OAuth refresh token, same pattern as
// lib/zoho.js), not the Calendar service account — service accounts have
// no storage quota of their own on a personal Google account, so any file
// they try to create fails with a 403 even in a folder shared with them.

const CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
const CONFIRMATION_FOLDER_ID = process.env.GOOGLE_DRIVE_CONFIRMATION_FOLDER_ID;

let cachedToken = null; // { token, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
    }),
  });
  if (!res.ok) throw new Error(`Google Drive auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

// Sets "anyone with the link can view" (not listed/searchable anywhere,
// but no Google sign-in required — the customer's link just needs to work)
// and returns the shareable URL.
async function makeShareable(fileId) {
  const token = await getAccessToken();
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google Drive share-link fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.webViewLink;
}

// Small-file upload (the generated PDF — a few hundred KB at most) — goes
// straight through this server route as one request.
export async function uploadFileAndShare({ name, mimeType, buffer }) {
  const token = await getAccessToken();
  const boundary = `whub_${crypto.randomBytes(16).toString("hex")}`;
  const metadata = { name, parents: CONFIRMATION_FOLDER_ID ? [CONFIRMATION_FOLDER_ID] : undefined };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Google Drive upload failed: ${res.status} ${await res.text()}`);
  const { id } = await res.json();
  return makeShareable(id);
}

// Large-file upload (video) — the browser uploads the bytes directly to
// Google using this session URL, never routing the file through our own
// server, which would otherwise hit Vercel's request body size limits.
export async function createResumableUploadSession({ name, mimeType }) {
  const token = await getAccessToken();
  const metadata = { name, parents: CONFIRMATION_FOLDER_ID ? [CONFIRMATION_FOLDER_ID] : undefined };
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
    },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) throw new Error(`Google Drive resumable session failed: ${res.status} ${await res.text()}`);
  const uploadUrl = res.headers.get("Location");
  if (!uploadUrl) throw new Error("Google Drive resumable session returned no upload URL");
  return uploadUrl;
}

// Called once the browser's finished PUTting the video bytes to the
// resumable session URL — that response has the new file's id, which still
// needs its share permission set before the link is usable.
export async function shareUploadedFile(fileId) {
  return makeShareable(fileId);
}
