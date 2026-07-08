import { NextResponse } from "next/server";
import { upsertCalendarEvent, deleteCalendarEvent } from "@/lib/googleCalendar";

// Pushes a booking's date + job-type colour to the public Google Calendar —
// never the customer/vehicle detail that lives in the `bookings` row. Called
// by the Office calendar right after it writes to Supabase.
export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body || !body.action) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    if (body.action === "upsert") {
      const { googleEventId, date, endDate, summary, colorId } = body;
      if (!date) return NextResponse.json({ error: "date is required" }, { status: 400 });
      const id = await upsertCalendarEvent({ googleEventId: googleEventId || null, date, endDate, summary, colorId });
      return NextResponse.json({ googleEventId: id });
    }

    if (body.action === "delete") {
      await deleteCalendarEvent(body.googleEventId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("calendar-sync failed", e);
    return NextResponse.json({ error: "Google Calendar sync failed" }, { status: 500 });
  }
}
