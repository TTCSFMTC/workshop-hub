import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { capForTechsOff, realBookingCountsByDate, PUBLIC_DAILY_CAP as DAILY_CAP } from "@/lib/bookingCapacity";
import { ingeniumCountsByDate, ingeniumSlotsFor } from "@/lib/ingenium";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "start and end are required (YYYY-MM-DD)" }, { status: 400 });
  }

  // JLR Ingenium customers get their own availability: one Ingenium car a day
  // Mon–Thu, three on Friday, one on Saturday (see lib/ingenium.js), counted
  // against Ingenium jobs only — a day already full of other work still shows open.
  if (searchParams.get("ingenium") === "1") {
    try {
      const [counts, { data: holidayRows, error: holidayError }] = await Promise.all([
        ingeniumCountsByDate(start, end),
        supabaseAdmin.from("holidays").select("name, date_from, date_to").lte("date_from", end).gte("date_to", start),
      ]);
      if (holidayError) throw holidayError;
      const caps = {};
      for (let t = new Date(`${start}T00:00:00Z`).getTime(), endT = new Date(`${end}T00:00:00Z`).getTime(); t <= endT; t += 86400000) {
        const iso = new Date(t).toISOString().slice(0, 10);
        const off = new Set();
        (holidayRows || []).forEach((h) => {
          if (iso >= h.date_from && iso <= h.date_to) {
            ["Ernesto", "Ervin"].forEach((tech) => { if ((h.name || "").toLowerCase().includes(tech.toLowerCase())) off.add(tech); });
          }
        });
        // Nobody in = no Ingenium slot that day; one technician in is enough.
        caps[iso] = off.size >= 2 ? 0 : ingeniumSlotsFor(iso);
      }
      return NextResponse.json({ counts, caps, ingenium: true });
    } catch (e) {
      console.error("ingenium availability lookup failed", e);
      return NextResponse.json({ error: "Failed to load availability" }, { status: 500 });
    }
  }

  let requestCounts, holidayRows, realCounts;
  try {
    const [{ data, error }, { data: holidayData, error: holidayError }, realBookingCounts] = await Promise.all([
      supabaseAdmin.rpc("public_booking_counts", { from_date: start, to_date: end }),
      supabaseAdmin.from("holidays").select("name, date_from, date_to").lte("date_from", end).gte("date_to", start),
      realBookingCountsByDate(start, end),
    ]);
    if (error) throw error;
    if (holidayError) throw holidayError;
    requestCounts = data;
    holidayRows = holidayData;
    realCounts = realBookingCounts;
  } catch (e) {
    console.error("availability lookup failed", e);
    return NextResponse.json({ error: "Failed to load availability" }, { status: 500 });
  }

  // Real bookings already on the diary (taken via the office New Booking
  // form) count toward the same capacity as public requests — otherwise a
  // day already full of real jobs would still show as wide open here.
  const counts = { ...realCounts };
  for (const row of requestCounts) counts[row.booking_date] = (counts[row.booking_date] || 0) + row.request_count;

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
