import { NextResponse } from "next/server";
import { buildLecWeeklyJobs, LEC_TO, LEC_CC } from "@/lib/lecWeekly";
import { sendLecWeeklyJobsEmail } from "@/lib/resend";

// Runs from Vercel Cron (see vercel.json) every Saturday morning: emails
// Roxanne at Lymm Engine Components the two weeks starting the coming Monday
// (non-Ingenium jobs: registration, make/model, job), copied to Chris.
// Protected by CRON_SECRET — Vercel sends it as a bearer token on cron calls.
//   ?to=someone@x.com  sends ONE test copy to that address only (nothing to
//                      Roxanne), labelled as a test.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { weeks, total } = await buildLecWeeklyJobs();
    const testTo = new URL(request.url).searchParams.get("to");
    if (testTo) {
      await sendLecWeeklyJobsEmail({ to: testTo, weeks, total, testNote: "TEST — this is how the Saturday email to Roxanne will look. Nothing has been sent to her." });
      return NextResponse.json({ ok: true, test: true, sentTo: testTo, total });
    }
    await sendLecWeeklyJobsEmail({ to: LEC_TO, cc: LEC_CC, weeks, total });
    return NextResponse.json({ ok: true, sentTo: LEC_TO, total });
  } catch (e) {
    console.error("lec weekly email failed", e);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
