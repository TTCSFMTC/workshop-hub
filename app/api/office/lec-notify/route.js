import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { lecJobForBooking, LEC_TO, LEC_CC } from "@/lib/lecWeekly";
import { sendLecNewJobEmail } from "@/lib/resend";

// Called by the hub when a booking is saved: if it falls inside the next two
// weeks (and isn't an Ingenium job or a provisional hold) Roxanne at Lymm
// Engine Components gets an instant "another job booked" email, copied to Chris.
export async function POST(request) {
  const store = await cookies();
  if (!isValidSession(store.get(SESSION_COOKIE)?.value)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Instant emails are switched off (too many); Roxanne gets the Saturday and
  // 1st-of-month lists only. Set LEC_INSTANT_EMAILS=on to bring them back.
  if (process.env.LEC_INSTANT_EMAILS !== "on") return NextResponse.json({ ok: true, sent: false, disabled: true });
  const body = await request.json().catch(() => null);
  if (!body?.bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
  try {
    const job = await lecJobForBooking(body.bookingId);
    if (!job) return NextResponse.json({ ok: true, sent: false });
    await sendLecNewJobEmail({ to: LEC_TO, cc: LEC_CC, job, kind: ["moved", "confirmed"].includes(body.kind) ? body.kind : "new" });
    return NextResponse.json({ ok: true, sent: true });
  } catch (e) {
    console.error("lec new-job email failed", e);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
