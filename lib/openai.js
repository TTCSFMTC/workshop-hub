import "server-only";

// Turns a WhatsApp voice note into text. Claude's Messages API doesn't accept
// raw audio, so this is the one place the app calls a non-Anthropic model —
// Whisper is speech-to-text only, the actual understanding of what was said
// still goes through Claude (see parseStockVoiceNote in lib/anthropic.js).
const API_KEY = process.env.OPENAI_API_KEY;

export async function transcribeAudio({ buffer, mimeType, filename }) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType || "audio/ogg" }), filename || "voice-note.ogg");
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Whisper transcription failed: ${JSON.stringify(data)}`);
  if (!data.text?.trim()) throw new Error("Whisper returned an empty transcript");
  return data.text.trim();
}
