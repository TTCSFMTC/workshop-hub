import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { createResumableUploadSession } from "@/lib/googleDrive";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Hands the browser a one-time Drive upload URL so the video's bytes go
// straight from the office device to Google, never through our own server
// — a multi-hundred-MB video would otherwise hit Vercel's request size
// limits.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.fileName || !body?.mimeType) return NextResponse.json({ error: "fileName and mimeType are required" }, { status: 400 });

  try {
    const uploadUrl = await createResumableUploadSession({ name: body.fileName, mimeType: body.mimeType });
    return NextResponse.json({ uploadUrl });
  } catch (e) {
    console.error("intake-video-session failed", e);
    return NextResponse.json({ error: "Failed to start the video upload — check server logs" }, { status: 500 });
  }
}
