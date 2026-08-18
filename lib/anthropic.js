import "server-only";

// Turns a technician's raw, often dictated, diagnosis notes into a short,
// clear explanation a customer can read and act on — used on the distance
// customer approval report. The technician's raw notes stay stored
// separately as the evidence record; this is only the polished version
// shown to the customer, and office reviews it before it's sent.

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-5";

export async function generateApprovalWriteup({ vehicleReg, vehicleModel, jobTypeName, rawNotes, price, inStock }) {
  const prompt = `You are writing a short, clear explanation for a customer of an independent vehicle workshop, describing extra work a technician has found is needed beyond the job originally booked in.

Vehicle: ${vehicleModel || "vehicle"} (${vehicleReg || "no registration given"})
Original job booked: ${jobTypeName || "not specified"}
${inStock ? "The part needed is already in stock, so this work can be completed while the vehicle is still at the workshop." : "This part is not currently in stock and would need to be ordered before this work can be done."}

Technician's raw notes on what was found:
"""
${rawNotes}
"""

Write 2-4 short paragraphs in plain English explaining what was found and why the extra work is needed. Do not invent technical details that aren't in the notes above. Do not mention the price — that's shown separately on the report. Write only the explanation itself: no greeting, no sign-off, no headings.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic write-up generation failed: ${JSON.stringify(data)}`);
  // Sonnet 5 can return an extended-thinking block ahead of the actual text
  // block, so pick out the text block(s) by type rather than assuming index 0.
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text) throw new Error("Anthropic returned an empty write-up");
  return text;
}

// Turns the technician's raw interpretation and diagnosis notes into a
// concise technical write-up suitable for a warranty company or legal
// review — the opposite brief to the customer approval write-up above:
// keep the technical language and specifics, don't soften or simplify
// anything, just tighten the raw dictated notes into a clear report.
export async function generateTechnicalWriteup({ vehicleReg, vehicleModel, jobTypeName, symptoms, technicianInterpretation, diagnosisFindings }) {
  const prompt = `You are writing a concise technical write-up of a vehicle diagnosis, for a warranty company or legal review. The reader is technically literate — do not simplify or soften technical language, and do not omit technical detail that's present in the notes below.

Vehicle: ${vehicleModel || "vehicle"} (${vehicleReg || "no registration given"})
Job booked: ${jobTypeName || "not specified"}

Customer-reported symptoms:
"""
${symptoms || "Not recorded"}
"""

Technician's interpretation:
"""
${technicianInterpretation || "Not recorded"}
"""

Technician's diagnosis findings:
"""
${diagnosisFindings || "Not recorded"}
"""

Write a concise technical report in plain text (no markdown formatting, no headings) covering: the reported symptom, the diagnostic approach/interpretation, and the findings. Do not invent any technical detail that isn't present in the notes above — if a section has nothing recorded, state that plainly rather than filling in a plausible-sounding explanation. Write only the report itself: no greeting, no sign-off.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic technical write-up generation failed: ${JSON.stringify(data)}`);
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text) throw new Error("Anthropic returned an empty technical write-up");
  return text;
}

// Converts a technician's Albanian dictation (captured as raw text by the
// browser's Albanian speech recognition — see DictateField) into English, so
// office and anyone downstream (warranty write-ups, job cards) can read it
// without needing the technician to redictate or retype it themselves.
export async function translateToEnglish({ text }) {
  const prompt = `Translate the following Albanian text into English. It was dictated by a vehicle workshop technician, so preserve mechanical/technical terminology as accurately as possible (engines, timing chains, parts, symptoms, vehicle makes and models). Respond with the English translation only — no commentary, no notes, no quotation marks.

"""
${text}
"""`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic translation failed: ${JSON.stringify(data)}`);
  const translated = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!translated) throw new Error("Anthropic returned an empty translation");
  return translated;
}

// Turns a transcribed WhatsApp voice note ("add six timing chain kits") into
// a specific part + quantity to add to stock. Only ever matches against the
// real parts list passed in — never invents a part — so an unclear or
// off-topic voice note comes back as low confidence rather than a guess
// getting written to real stock (the WhatsApp route only acts on
// confidence:"high", and always asks the technician to confirm first either
// way — see app/api/whatsapp/stock/route.js).
export async function parseStockVoiceNote({ transcript, parts }) {
  const partsList = parts.map((p) => `${p.id} | ${p.name} (${p.unit})`).join("\n");
  const prompt = `A vehicle workshop technician left a voice note about adding stock. Here is the transcript:

"""
${transcript}
"""

Here is the full list of known parts (id | name (unit)) — only ever pick a part from this list, never invent one:
${partsList}

Work out which part they mean and what quantity to add. Respond with strict JSON only — no markdown formatting, no commentary before or after — matching exactly this shape:
{ "partId": string or null, "qty": number or null, "confidence": "high" or "low", "note": string }

Use "confidence":"low" if you're not reasonably sure which part was meant, or the quantity is unclear — still give your best guess for partId/qty if you have one, just flag it as low confidence. "note" is a short (under 15 words) plain description of what you understood, e.g. "6 x Timing Chain Kit (Ingenium)" — this gets shown back to the technician to confirm.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic stock voice note parse failed: ${JSON.stringify(data)}`);
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text) throw new Error("Anthropic returned an empty response while parsing the voice note");

  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Could not parse stock voice note result as JSON: ${cleaned.slice(0, 300)}`);
  }
}

// Reads a scanned supplier invoice PDF and pulls out the fields office needs
// to file it and (once confirmed) post it to Zoho Books as a Bill. Returns
// parsed JSON, not prose — unlike the two write-up functions above, this is
// structured data the review UI pre-fills a form with, not text shown as-is.
export async function extractInvoiceData({ pdfBase64 }) {
  const instructions = `This is a supplier invoice for a vehicle repair workshop's parts purchases. Extract its details as strict JSON only — no markdown formatting, no code fences, no commentary before or after — matching exactly this shape:

{
  "vendor_name": string or null,
  "invoice_number": string or null,
  "invoice_date": string or null (YYYY-MM-DD),
  "due_date": string or null (YYYY-MM-DD),
  "subtotal": number or null,
  "tax": number or null,
  "total": number or null,
  "line_items": [{ "description": string, "quantity": number, "unit_price": number or null, "amount": number }]
}

If a field isn't present on the invoice, use null (or an empty array for line_items) rather than guessing. Respond with the JSON object only.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: instructions },
        ],
      }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic invoice extraction failed: ${JSON.stringify(data)}`);
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text) throw new Error("Anthropic returned an empty response while extracting the invoice");

  // Claude occasionally wraps JSON in a ```json fence despite being told not
  // to — strip it defensively rather than failing the whole upload over it.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Could not parse invoice data as JSON: ${cleaned.slice(0, 300)}`);
  }
  return parsed;
}
