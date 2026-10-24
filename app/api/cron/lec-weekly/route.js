import { NextResponse } from "next/server";
import { buildLecWeeklyJobs } from "@/lib/lecWeekly";
import { sendLecWeeklyJobsEmail } from "@/lib/resend";

// Runs from Vercel Cron (see vercel.json) every Monday morning: emails
// Roxanne at Lymm Engine Components the next two weeks of non-Ingenium jobs
// (registration, make/model, job) with a copy to the office. Protected by
// CRON_SECRET — Vercel sends it as a bearer token on cron calls.
//   ?to=someone@x.com  sends ONE test copy to that address only (no Roxanne,
//                      no copy), labelled as a test.
const LEC_ADDRESS = "roxanne@lymmengineparts.co.uk";

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { weeks, total } = await buildLecWeeklyJobs();
    const testTo = new URL(request.url).searchParams.get("to");
    if (testTo) {
      await sendLecWeeklyJobsEmail({ to: testTo, weeks, total, testNote: "TEST — this is how the Monday email to Roxanne will look. Nothing has been sent to her." });
      return NextResponse.json({ ok: true, test: true, sentTo: testTo, total });
    }
    await sendLecWeeklyJobsEmail({ to: LEC_ADDRESS, cc: process.env.OFFICE_NOTIFICATION_EMAIL || undefined, weeks, total });
    return NextResponse.json({ ok: true, sentTo: LEC_ADDRESS, total });
  } catch (e) {
    console.error("lec weekly email failed", e);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
