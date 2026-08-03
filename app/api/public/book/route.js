import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { BUSINESSES } from "@/lib/constants";
import { sendBookingRequestNotification } from "@/lib/resend";
import { techsOffOn, capForTechsOff } from "@/lib/bookingCapacity";

const DAILY_CAP = 3;
const MIN_NOTICE_DAYS = 7;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const isValidFutureDate = (d) => DATE_RE.test(d) && !Number.isNaN(new Date(d).getTime()) && d >= todayISO();

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const name = (body.name || "").trim();
  const address = (body.address || "").trim();
  const phone = (body.phone || "").trim();
  const reg = (body.reg || "").trim().toUpperCase();
  const business = body.business || "";
  const isEmergency = !!body.isEmergency;
  const otherDetails = (body.otherDetails || "").trim();
  const requirements = Array.isArray(body.requirements) ? body.requirements.filter(Boolean) : [];
  const isOther = !isEmergency && requirements.includes("Other");

  if (!name || !phone || !reg) {
    return NextResponse.json({ error: "Name, phone, and registration are required." }, { status: 400 });
  }
  if (!BUSINESSES.includes(business)) {
    return NextResponse.json({ error: "Please select which business you're booking with." }, { status: 400 });
  }
  if (isOther && !otherDetails) {
    return NextResponse.json({ error: "Please tell us what you need." }, { status: 400 });
  }
  if (!isEmergency && !isOther && requirements.length === 0) {
    return NextResponse.json({ error: "Please select at least one requirement." }, { status: 400 });
  }

  // Emergency skips the normal notice window and daily cap entirely — it's
  // always accepted (never silently refused) with two preferred dates, and
  // office triages actual capacity manually via the Emergency flag in the
  // Booking Requests tab. This is the one path that doesn't go through the
  // shared countForDate/capacity checks below.
  if (isEmergency) {
    const date = body.date || "";
    const secondDate = body.secondDate || "";
    if (!isValidFutureDate(date) || !isValidFutureDate(secondDate)) {
      return NextResponse.json({ error: "Please give two valid dates, today or later." }, { status: 400 });
    }
    try {
      const { error: insertError } = await supabaseAdmin.from("booking_requests").insert({
        name, address, phone, reg, business, date, second_date: secondDate,
        requirements: ["Emergency Appointment"], is_emergency: true,
      });
      if (insertError) throw insertError;
      try {
        await sendBookingRequestNotification({
          name, business, phone, reg, date, requirements: ["Emergency Appointment"], needsReview: true, isEmergency: true,
        });
      } catch (emailError) {
        console.error("booking request email failed", emailError);
      }
      return NextResponse.json({ ok: true });
    } catch (e) {
      console.error("emergency booking request failed", e);
      return NextResponse.json({ error: "Something went wrong — please try again." }, { status: 500 });
    }
  }

  // Standard and Other both use a single date under the normal notice-window
  // and capacity rules — Other just swaps the job-type checklist for a
  // free-text description of what's needed.
  const date = body.date || "";
  if (!DATE_RE.test(date) || Number.isNaN(new Date(date).getTime())) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }
  if (date < todayISO()) {
    return NextResponse.json({ error: "Can't book a date in the past." }, { status: 400 });
  }
  // A week's notice gives office time to check parts and staffing before the
  // vehicle arrives — under that, we'd rather the customer speaks to someone
  // directly than book in blind.
  if (date < addDaysISO(todayISO(), MIN_NOTICE_DAYS)) {
    return NextResponse.json(
      { error: "We need at least a week's notice for a booking — please pick a later date.", offerContact: true },
      { status: 400 }
    );
  }

  const countForDate = async () => {
    const { count, error } = await supabaseAdmin
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("date", date)
      .neq("status", "declined");
    if (error) throw error;
    return count;
  };

  try {
    // A holiday shrinks (or zeroes out) what a day can actually take —
    // computed fresh each submission rather than office having to remember
    // to block dates manually whenever someone books time off.
    const techsOff = await techsOffOn(date);
    const effectiveCap = capForTechsOff(techsOff.length, DAILY_CAP);
    if (effectiveCap === 0) {
      return NextResponse.json(
        { error: "We're short-staffed that day — please pick another, or get in touch if it's urgent.", offerContact: true },
        { status: 409 }
      );
    }

    const before = await countForDate();
    if (before >= effectiveCap) {
      return NextResponse.json({ error: "That day is fully booked — please pick another.", offerContact: true }, { status: 409 });
    }

    const { data, error: insertError } = await supabaseAdmin
      .from("booking_requests")
      .insert({ name, address, phone, reg, business, date, requirements, other_details: isOther ? otherDetails : null })
      .select("id")
      .single();
    if (insertError) throw insertError;

    // Re-check after inserting to catch a simultaneous submission that also
    // slipped past the first check — whichever request loses gets rolled back.
    const after = await countForDate();
    if (after > effectiveCap) {
      await supabaseAdmin.from("booking_requests").delete().eq("id", data.id);
      return NextResponse.json({ error: "That day just filled up — please pick another.", offerContact: true }, { status: 409 });
    }

    // A failed notification shouldn't turn a successful request into an
    // error for the customer — office can still see it was submitted via
    // the Booking Requests tab even if the email never arrives.
    try {
      const needsReview = isOther || requirements.some((r) => r.toLowerCase().includes("chain"));
      await sendBookingRequestNotification({
        name, business, phone, reg, date, requirements, needsReview, otherDetails: isOther ? otherDetails : undefined,
      });
    } catch (emailError) {
      console.error("booking request email failed", emailError);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("booking request failed", e);
    return NextResponse.json({ error: "Something went wrong — please try again." }, { status: 500 });
  }
}
