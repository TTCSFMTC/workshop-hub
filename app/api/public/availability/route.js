import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { capForTechsOff } from "@/lib/bookingCapacity";

const DAILY_CAP = 3;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "start and end are required (YYYY-MM-DD)" }, { status: 400 });
  }

  const [{ data, error }, { data: holidayRows, error: holidayError }] = await Promise.all([
    supabaseAdmin.rpc("public_booking_counts", { from_date: start, to_date: end }),
    supabaseAdmin.from("holidays").select("name, date_from, date_to").lte("date_from", end).gte("date_to", start),
  ]);
  if (error) {
    console.error("availability rpc failed", error);
    return NextResponse.json({ error: "Failed to load availability" }, { status: 500 });
  }
  if (holidayError) {
    console.error("availability holiday lookup failed", holidayError);
    return NextResponse.json({ error: "Failed to load availability" }, { status: 500 });
  }

  const counts = {};
  for (const row of data) counts[row.booking_date] = row.request_count;

  // Per-day cap, shrunk for any date a technician's on holiday — computed
  // per calendar day in the requested range so the public calendar can show
  // accurate slots without duplicating the holiday-matching logic client-side.
  const TECHS = ["Ernesto", "Ervin"];
  const caps = {};
  for (let t = new Date(`${start}T00:00:00Z`).getTime(), endT = new Date(`${end}T00:00:00Z`).getTime(); t <= endT; t += 86400000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const off = new Set();
    (holidayRows || []).forEach((h) => {
      if (iso >= h.date_from && iso <= h.date_to) {
        TECHS.forEach((tech) => { if ((h.name || "").toLowerCase().includes(tech.toLowerCase())) off.add(tech); });
      }
    });
    caps[iso] = capForTechsOff(off.size, DAILY_CAP);
  }

  return NextResponse.json({ counts, cap: DAILY_CAP, caps });
}
