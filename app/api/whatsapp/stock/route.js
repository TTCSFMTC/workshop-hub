import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { verifyTwilioSignature } from "@/lib/twilio";
import { transcribeAudio } from "@/lib/openai";
import { parseStockVoiceNote } from "@/lib/anthropic";

const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTHORIZED_NUMBER = process.env.WHATSAPP_STOCK_AUTHORIZED_NUMBER;
// How long a "add N of X?" prompt stays open for a YES/NO reply before it's
// treated as stale — long enough to actually read and reply to a WhatsApp
// message, short enough that an old "yes" sent for an unrelated reason days
// later can't accidentally confirm a stale request.
const PENDING_WINDOW_MS = 15 * 60 * 1000;

const uid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function twiml(message) {
  const escaped = String(message).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

// Twilio webhook — no session cookie (Twilio's servers aren't logged into
// the app), so this route is protected by the request signature (proves it
// really came from Twilio) plus a hardcoded authorized sender number (proves
// it's actually Chris's phone, not just anyone who joined the sandbox).
export async function POST(request) {
  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  const signature = request.headers.get("x-twilio-signature");

  if (!verifyTwilioSignature({ url: request.url, params, signature, authToken: AUTH_TOKEN })) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const from = params.From || "";
  if (from !== AUTHORIZED_NUMBER) {
    return twiml("Sorry, this number isn't authorised to add stock.");
  }

  const numMedia = Number(params.NumMedia || 0);
  const contentType = params.MediaContentType0 || "";

  if (numMedia > 0 && contentType.startsWith("audio/")) {
    return handleVoiceNote({ mediaUrl: params.MediaUrl0, contentType, from });
  }
  return handleTextReply({ from, body: (params.Body || "").trim() });
}

async function handleVoiceNote({ mediaUrl, contentType, from }) {
  try {
    const basicAuth = "Basic " + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
    const mediaRes = await fetch(mediaUrl, { headers: { Authorization: basicAuth } });
    if (!mediaRes.ok) throw new Error(`Failed to download voice note: ${mediaRes.status}`);
    const buffer = Buffer.from(await mediaRes.arrayBuffer());

    const transcript = await transcribeAudio({ buffer, mimeType: contentType, filename: "voice-note.ogg" });

    const { data: partsRows, error: partsError } = await supabase.from("parts").select("id,name,unit");
    if (partsError) throw partsError;

    const parsed = await parseStockVoiceNote({ transcript, parts: partsRows });
    const part = parsed.partId ? partsRows.find((p) => p.id === parsed.partId) : null;

    if (!part || !parsed.qty || parsed.confidence === "low") {
      return twiml(`I heard: "${transcript}"\n\nI couldn't confidently work out the part and quantity — could you resend more clearly, e.g. "add 6 timing chain kits"?`);
    }

    const reqId = uid("wsr");
    const { error: insertError } = await supabase.from("whatsapp_stock_requests").insert({
      id: reqId, from_number: from, transcript, part_id: part.id, part_name: part.name, qty: parsed.qty, status: "pending",
    });
    if (insertError) throw insertError;

    return twiml(`I heard: "${transcript}"\n\nAdd ${parsed.qty} x ${part.name} to stock? Reply YES to confirm or NO to cancel.`);
  } catch (e) {
    console.error("whatsapp stock voice note failed", e);
    return twiml("Sorry, something went wrong processing that voice note — please try again.");
  }
}

async function handleTextReply({ from, body }) {
  const normalized = body.toLowerCase();
  const isYes = ["yes", "y", "confirm", "ok", "okay"].includes(normalized);
  const isNo = ["no", "n", "cancel"].includes(normalized);

  if (!isYes && !isNo) {
    return twiml('Send a voice note naming the part and quantity to add to stock (e.g. "add 6 timing chain kits"). Reply YES or NO to confirm a pending request.');
  }

  const cutoff = new Date(Date.now() - PENDING_WINDOW_MS).toISOString();
  const { data: pending, error: pendingError } = await supabase
    .from("whatsapp_stock_requests")
    .select("*")
    .eq("from_number", from)
    .eq("status", "pending")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1);
  if (pendingError) {
    console.error("whatsapp stock lookup failed", pendingError);
    return twiml("Sorry, something went wrong — please try again.");
  }

  const req = pending?.[0];
  if (!req) return twiml("No pending stock request to confirm — send a voice note first.");

  if (isNo) {
    await supabase.from("whatsapp_stock_requests").update({ status: "cancelled", resolved_at: new Date().toISOString() }).eq("id", req.id);
    return twiml("Cancelled — nothing added to stock.");
  }

  try {
    // Stock isn't a stored number on the part — it's the sum of delivered
    // batches' qty_remaining (see derivePartFromBatches in WorkshopHub.jsx).
    // This mirrors that so the confirmation reply's "new total" is accurate,
    // and reuses the most recent delivered price rather than guessing one.
    const { data: existingBatches, error: batchesError } = await supabase
      .from("stock_batches")
      .select("qty_remaining,price,delivered_at")
      .eq("part_id", req.part_id)
      .eq("status", "delivered")
      .order("delivered_at", { ascending: false });
    if (batchesError) throw batchesError;

    const currentStock = (existingBatches || []).reduce((sum, b) => sum + Number(b.qty_remaining), 0);
    const lastPrice = existingBatches?.[0]?.price || 0;
    const now = new Date().toISOString();

    const { error: batchError } = await supabase.from("stock_batches").insert({
      id: uid("sb"), part_id: req.part_id, qty_ordered: req.qty, qty_remaining: req.qty, price: lastPrice,
      supplier: null, status: "delivered", ordered_at: now, delivered_at: now,
    });
    if (batchError) throw batchError;

    const { error: auditError } = await supabase.from("audit_log").insert({
      id: uid("al"), summary: `Stock added via WhatsApp voice note: ${req.part_name} +${req.qty}`, reason: req.transcript, created_at: now,
    });
    if (auditError) throw auditError;

    await supabase.from("whatsapp_stock_requests").update({ status: "confirmed", resolved_at: now }).eq("id", req.id);

    return twiml(`Added ${req.qty} x ${req.part_name} to stock. New total: ${currentStock + Number(req.qty)}.`);
  } catch (e) {
    console.error("whatsapp stock confirm failed", e);
    return twiml("Sorry, something went wrong adding that to stock — please try again or add it manually.");
  }
}
