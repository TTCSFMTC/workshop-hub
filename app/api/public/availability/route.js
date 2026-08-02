import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const DAILY_CAP = 3;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "start and end are required (YYYY-MM-DD)" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("public_booking_counts", {
    from_date: start,
    to_date: end,
  });
  if (error) {
    console.error("availability rpc failed", error);
    return NextResponse.json({ error: "Failed to load availability" }, { status: 500 });
  }

  const counts = {};
  for (const row of data) counts[row.booking_date] = row.request_count;
  return NextResponse.json({ counts, cap: DAILY_CAP });
}
