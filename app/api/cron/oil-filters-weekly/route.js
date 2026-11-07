import { NextResponse } from "next/server";
import { todayUK } from "@/lib/lecWeekly";
import { buildOilFilterList } from "@/lib/oilFilters";
import { generateOilFilterPdf, oilFilterRangeLabel } from "@/lib/oilFilterPdf";
import { sendOilFilterListEmail } from "@/lib/resend";

// Runs from Vercel Cron (see vercel.json) every Saturday morning: emails the
// office an A4 PDF of the oil filters to order for each registration coming in
// Tuesday to the Monday after (Monday included so a late delivery still leaves
// every car covered). Protected by CRON_SECRET, sent as a bearer token by Vercel.
// Recipient: OIL_FILTER_EMAIL_TO, else the office notification address.
//   ?to=someone@x.com  sends ONE test copy to that address only, labelled TEST.
//   ?dry=1             returns the list that WOULD be sent, sends nothing.
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
    const today = (testTo || dry) && /^\d{4}-\d{2}-\d{2}$/.test(q.get("today") || "") ? q.get("today") : todayUK();
    const list = await buildOilFilterList({ today });
    if (dry) return NextResponse.json({ ok: true, dry: true, today, ...list });
    const to = testTo || process.env.OIL_FILTER_EMAIL_TO || process.env.OFFICE_NOTIFICATION_EMAIL;
    if (!to) return NextResponse.json({ error: "No recipient configured (OIL_FILTER_EMAIL_TO / OFFICE_NOTIFICATION_EMAIL)" }, { status: 500 });
    const pdfBytes = await generateOilFilterPdf(list);
    await sendOilFilterListEmail({
      to, pdfBytes,
      filename: `oil-filters-${list.start}-to-${list.end}.pdf`,
      rangeLabel: oilFilterRangeLabel(list.start, list.end),
      jobCount: list.rows.length, filterCount: list.filterCount, noFilterCount: list.noFilterCount,
      testNote: testTo ? `TEST (as of ${today}) — this is how the Saturday email will look.` : undefined,
    });
    return NextResponse.json({ ok: true, sentTo: to, jobs: list.rows.length, filters: list.filterCount });
  } catch (e) {
    console.error("oil filter weekly email failed", e);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
