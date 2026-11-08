import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadPartsContext, bookingBoms } from "@/lib/bookingParts";

// Jobs list for the engine-parts supplier (Lymm Engine Components): registration,
// make/model and job only, never Ingenium jobs, never customer details or prices.
export const LEC_TO = "roxanne@lymmengineparts.co.uk";
export const LEC_CC = "chris@w4x4.co.uk";

export const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
export const dowOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sun
const fmt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const todayUK = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

// Monday following `iso` (always in the future — a Saturday gives +2).
export const nextMonday = (iso) => addDays(iso, ((8 - dowOf(iso)) % 7) || 7);

// Third working day (Mon–Fri) of the month after `iso`'s month. Jobs dated
// later than this are held back and go out in the email on the 1st.
export const monthCutoff = (iso) => {
  const [y, m] = iso.split("-").map(Number);
  let d = `${new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)}`;
  for (let seen = 0; ; d = addDays(d, 1)) {
    if (dowOf(d) !== 0 && dowOf(d) !== 6 && ++seen === 3) return d;
  }
};
export const fmtLec = fmt;

async function loadNames() {
  const [{ data: jobTypes, error: e2 }, { data: extras, error: e3 }] = await Promise.all([
    supabaseAdmin.from("job_types").select("id, name"),
    supabaseAdmin.from("booking_job_types").select("booking_id, job_type_id"),
  ]);
  if (e2 || e3) throw e2 || e3;
  const name = Object.fromEntries(jobTypes.map((j) => [j.id, j.name]));
  const extraNames = {};
  (extras || []).forEach((x) => { (extraNames[x.booking_id] = extraNames[x.booking_id] || []).push(name[x.job_type_id]); });
  return { name, extraNames };
}

const toJob = (b, name, extraNames) => ({
  date: b.date,
  reg: b.reg || "—",
  vehicle: b.vehicle_model || "—",
  names: [name[b.job_type_id], ...(extraNames[b.id] || [])].filter(Boolean),
});
const isIngenium = (j) => j.names.some((n) => /ingenium/i.test(n));
// Engine rebuilds are specific, one-off jobs: they stay off Roxanne's Saturday
// list and never trigger an extra-job email — Chris sorts those parts himself.
const HELD_BACK = /rebuild/i;
const isHeldBack = (j) => j.names.some((n) => HELD_BACK.test(n));

// Saturday email (mode "weekly"): the two full weeks starting the coming
// Monday, but only up to the third working day of next month — anything after
// that is held back for the email on the 1st (mode "first"), which covers the
// next two weeks from the 1st.
export async function buildLecWeeklyJobs({ mode = "weekly", today = todayUK() } = {}) {
  const first = mode === "first";
  const start = first ? today : nextMonday(today);
  const weekTwo = addDays(start, 7);
  const fullEnd = addDays(start, 13);
  const cutoff = monthCutoff(today);
  const capped = !first && cutoff < fullEnd;
  const end = capped ? cutoff : fullEnd;
  const { data: bookings, error } = end < start ? { data: [], error: null } : await supabaseAdmin
    .from("bookings")
    .select("id, date, reg, vehicle_model, job_type_id, provisional, customer_cancelled, workshop_completed, completed")
    .gte("date", start).lte("date", end).eq("customer_cancelled", false).order("date");
  if (error) throw error;
  const { name, extraNames } = await loadNames();
  const jobs = bookings
    .filter((b) => !b.provisional && !b.completed && !b.workshop_completed)
    .map((b) => toJob(b, name, extraNames))
    .filter((j) => !isIngenium(j) && !isHeldBack(j))
    .map((j) => ({ date: j.date, reg: j.reg, vehicle: j.vehicle, job: j.names.join(" + ") || "Job not set" }));
  const weeks = first
    ? [
        { title: `${fmt(start)} – ${fmt(addDays(start, 6))}`, jobs: jobs.filter((j) => j.date < weekTwo) },
        { title: `${fmt(weekTwo)} – ${fmt(fullEnd)}`, jobs: jobs.filter((j) => j.date >= weekTwo) },
      ]
    : [
        { title: `Week commencing Monday ${fmt(start)}`, jobs: jobs.filter((j) => j.date < weekTwo) },
        ...(end >= weekTwo ? [{ title: `Week commencing Monday ${fmt(weekTwo)}`, jobs: jobs.filter((j) => j.date >= weekTwo) }] : []),
      ];
  return { weeks, total: jobs.length, first, heldFrom: capped ? addDays(end, 1) : null, upTo: capped ? end : null };
}

// The Saturday list that hasn't gone yet: today if it's Saturday before the
// 08:00 UTC run, otherwise the coming Saturday.
export function nextSaturdayRun(today = todayUK(), now = new Date()) {
  const dow = dowOf(today);
  if (dow === 6 && now.getUTCHours() < 8) return today;
  return addDays(today, (6 - dow + 7) % 7 || 7);
}

// Extra-job email rule: Roxanne only gets an extra email when the new booking
// lands in the present week or on the Monday straight after it. Anything later
// is picked up by the next Saturday email, so it waits for that. On Saturday
// (after the list has gone) and Sunday the "present week" is the coming week,
// since that weekend's list is already with her.
export function needsInstantEmail(date, today = todayUK(), now = new Date()) {
  if (!date || date < today) return false;
  return date <= nextMonday(nextSaturdayRun(today, now));
}

// One booking, for the instant "another job booked" email — only when it lands
// in the present week or the Monday after (see needsInstantEmail), and it isn't
// Ingenium, an engine rebuild or a provisional hold. Includes the parts the job
// needs so Roxanne can line them up.
export async function lecJobForBooking(bookingId) {
  const { data: b, error } = await supabaseAdmin
    .from("bookings")
    .select("id, date, reg, vehicle_model, job_type_id, provisional, customer_cancelled, workshop_completed, completed")
    .eq("id", bookingId).maybeSingle();
  if (error) throw error;
  if (!b || b.provisional || b.customer_cancelled || b.completed) return null;
  const today = todayUK();
  if (!needsInstantEmail(b.date, today)) return null;
  const { name, extraNames } = await loadNames();
  const j = toJob(b, name, extraNames);
  if (isIngenium(j) || isHeldBack(j)) return null;
  const bom = (await bookingBoms([b], await loadPartsContext())).get(b.id);
  return {
    reg: j.reg, vehicle: j.vehicle, job: j.names.join(" + ") || "Job not set",
    date: b.date,
    when: b.date < nextMonday(today) ? "this week"
      : b.date === nextMonday(today) && dowOf(today) >= 1 && dowOf(today) <= 5 ? "Monday"
      : b.date < addDays(nextMonday(today), 7) ? "next week" : "Monday week",
    parts: (bom?.lines || []).map((l) => ({ name: l.name, partNumber: l.partNumber, qty: l.qty, unit: l.unit })),
  };
}
