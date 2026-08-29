import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { BUSINESSES } from "@/lib/constants";
import { sendBookingRequestNotification, sendTransportRequestEmail } from "@/lib/resend";
import { techsOffOn, capForTechsOff, realBookingCountForDate } from "@/lib/bookingCapacity";

const DAILY_CAP = 3;
const MIN_NOTICE_DAYS = 7;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A chain job at the workshop always takes 3 days regardless of which
// specific chain/kit it is — collection and/or delivery each add a day on
// top of that (a day to fetch it, a separate day to run it back), never
// blocking any extra calendar capacity themselves (see migration_053) —
// purely so the customer and office both know what to expect up front.
const WORKSHOP_DAYS = 3;
const estimatedDaysFor = (transportType) =>
  transportType === "collect_deliver" ? WORKSHOP_DAYS + 2 : transportType === "collect" ? WORKSHOP_DAYS + 1 : WORKSHOP_DAYS;
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
  const email = (body.email || "").trim();
  const reg = (body.reg || "").trim().toUpperCase();
  const business = body.business || "";
  const isEmergency = !!body.isEmergency;
  const otherDetails = (body.otherDetails || "").trim();
  const requirements = Array.isArray(body.requirements) ? body.requirements.filter(Boolean) : [];
  const isOther = !isEmergency && requirements.includes("Other");
  const isNonRunner = !!body.isNonRunner;
  const symptoms = (body.symptoms || "").trim();
  const termsAccepted = !!body.termsAccepted;
  // Collection/delivery is only ever offered for a Timing Chain Specialists
  // chain job — anything else sent from the client is ignored rather than
  // trusted, same reasoning as recomputing estimatedDays server-side below
  // instead of accepting whatever the client sends.
  const isChainJob = requirements.some((r) => r.toLowerCase().includes("chain"));
  const transportEligible = business === "Timing Chain Specialists" && isChainJob && !isEmergency && !isOther;
  const requestedTransportType = ["collect", "collect_deliver"].includes(body.transportType) ? body.transportType : "none";
  const transportType = transportEligible ? requestedTransportType : "none";
  const estimatedDays = transportEligible ? estimatedDaysFor(transportType) : null;

  if (!name || !phone || !reg) {
    return NextResponse.json({ error: "Name, phone, and registration are required." }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (!symptoms) {
    return NextResponse.json({ error: "Please tell us the symptoms or any warning lights." }, { status: 400 });
  }
  if (!termsAccepted) {
    return NextResponse.json({ error: "Please accept the terms and conditions to continue." }, { status: 400 });
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
        name, address, phone, email, reg, business, date, second_date: secondDate,
        requirements: ["Emergency Appointment"], is_emergency: true,
        is_non_runner: isNonRunner, symptoms, terms_accepted_at: new Date().toISOString(),
      });
      if (insertError) throw insertError;
      try {
        await sendBookingRequestNotification({
          name, business, phone, email, reg, date, requirements: ["Emergency Appointment"], needsReview: true, isEmergency: true,
          isNonRunner, symptoms,
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

  // Real bookings already on the diary (taken via the office New Booking
  // form) count toward the same capacity as public requests — otherwise
  // this check could let a day already full of real jobs accept another
  // request anyway.
  const countForDate = async () => {
    const { count, error } = await supabaseAdmin
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("date", date)
      .neq("status", "declined");
    if (error) throw error;
    const realCount = await realBookingCountForDate(date);
    return (count || 0) + realCount;
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
      .insert({
        name, address, phone, email, reg, business, date, requirements, other_details: isOther ? otherDetails : null,
        is_non_runner: isNonRunner, symptoms, terms_accepted_at: new Date().toISOString(),
        transport_type: transportType, estimated_days: estimatedDays,
        transport_status: transportType === "none" ? "not_required" : "pending",
      })
      .select("id, transport_token")
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
      const needsReview = isOther || isChainJob;
      await sendBookingRequestNotification({
        name, business, phone, email, reg, date, requirements, needsReview, otherDetails: isOther ? otherDetails : undefined,
        isNonRunner, symptoms, transportType, estimatedDays,
      });
    } catch (emailError) {
      console.error("booking request email failed", emailError);
    }

    // Transport only ever gets asked once we know the request itself is
    // valid and has a slot — no point troubling them over a day that was
    // about to be declined anyway for being full.
    if (transportType !== "none") {
      try {
        const { data: settingsRow } = await supabaseAdmin.from("settings").select("transport_contact_name, transport_contact_email").eq("id", true).maybeSingle();
        if (settingsRow?.transport_contact_email) {
          const base = request.nextUrl.origin;
          await sendTransportRequestEmail({
            to: settingsRow.transport_contact_email,
            transportContactName: settingsRow.transport_contact_name,
            name, reg, address, business, date, transportType, estimatedDays,
            approveUrl: `${base}/transport-response/${data.transport_token}?action=approve`,
            declineUrl: `${base}/transport-response/${data.transport_token}?action=decline`,
          });
        } else {
          console.error("collection requested but no transport_contact_email configured in Settings");
        }
      } catch (transportEmailError) {
        console.error("transport request email failed", transportEmailError);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("booking request failed", e);
    return NextResponse.json({ error: "Something went wrong — please try again." }, { status: 500 });
  }
}
