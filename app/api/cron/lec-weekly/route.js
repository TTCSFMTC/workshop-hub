import { NextResponse } from "next/server";
import { buildLecWeeklyJobs, todayUK, LEC_TO, LEC_CC } from "@/lib/lecWeekly";
import { sendLecWeeklyJobsEmail } from "@/lib/resend";

// Runs from Vercel Cron (see vercel.json) every Saturday morning: emails
// Roxanne at Lymm Engine Components the two weeks starting the coming Monday
// (non-Ingenium jobs: registration, make/model, job), copied to Chris.
// Protected by CRON_SECRET — Vercel sends it as a bearer token on cron calls.
// Month rule: the Saturday email stops at the third working day of next month;
// the rest is held back and sent by the "first" run (cron on the 1st,
// ?mode=first) which covers the next two weeks from the 1st. The Saturday run
// does nothing when Saturday is itself the 1st (the 1st run covers it).
//   ?to=someone@x.com  sends ONE test copy to that address only (nothing to
//                      Roxanne), labelled as a test.
//   ?dry=1             returns what WOULD be sent, sends nothing.
//   ?today=YYYY-MM-DD  pretend it is that day (only with ?to or ?dry).
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const q = new URL(request.url).searchParams;
    const testTo = q.get("to");
    const dry = q.get("dry");
    const mode = q.get("mode") === "first" ? "first" : "weekly";
    const today = (testTo || dry) && /^\d{4}-\d{2}-\d{2}$/.test(q.get("today") || "") ? q.get("today") : todayUK();
    if (!testTo && !dry && mode === "weekly" && today.endsWith("-01")) {
      return NextResponse.json({ ok: true, skipped: "1st of the month — covered by the first-of-month email" });
    }
    const result = await buildLecWeeklyJobs({ mode, today });
    if (dry) return NextResponse.json({ ok: true, dry: true, mode, today, ...result });
    if (testTo) {
      await sendLecWeeklyJobsEmail({ to: testTo, ...result, testNote: `TEST (${mode}, as of ${today}) — this is how the email to Roxanne will look. Nothing has been sent to her.` });
      return NextResponse.json({ ok: true, test: true, sentTo: testTo, total: result.total });
    }
    await sendLecWeeklyJobsEmail({ to: LEC_TO, cc: LEC_CC, ...result });
    return NextResponse.json({ ok: true, sentTo: LEC_TO, mode, total: result.total });
  } catch (e) {
    console.error("lec weekly email failed", e);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
