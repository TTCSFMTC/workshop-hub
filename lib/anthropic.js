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
