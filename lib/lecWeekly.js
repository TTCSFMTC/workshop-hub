import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// The next two weeks of real bookings (today to the end of the day 13 days
// on), minus Ingenium jobs — used for the weekly email to the engine-parts
// supplier. Registration, make/model and job name only.
const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const fmt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export async function buildLecWeeklyJobs() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const weekTwoStart = addDays(today, 7);
  const end = addDays(today, 13);

  const [{ data: bookings, error: e1 }, { data: jobTypes, error: e2 }, { data: extras, error: e3 }] = await Promise.all([
    supabaseAdmin.from("bookings").select("id, date, reg, vehicle_model, job_type_id, provisional, customer_cancelled, workshop_completed, completed")
      .gte("date", today).lte("date", end).eq("customer_cancelled", false).order("date"),
    supabaseAdmin.from("job_types").select("id, name"),
    supabaseAdmin.from("booking_job_types").select("booking_id, job_type_id"),
  ]);
  if (e1 || e2 || e3) throw e1 || e2 || e3;

  const name = Object.fromEntries(jobTypes.map((j) => [j.id, j.name]));
  const extraNames = {};
  (extras || []).forEach((x) => { (extraNames[x.booking_id] = extraNames[x.booking_id] || []).push(name[x.job_type_id]); });

  const jobs = bookings
    .filter((b) => !b.provisional && !b.completed && !b.workshop_completed)
    .map((b) => ({ date: b.date, reg: b.reg || "—", vehicle: b.vehicle_model || "—", names: [name[b.job_type_id], ...(extraNames[b.id] || [])].filter(Boolean) }))
    .filter((j) => !j.names.some((n) => /ingenium/i.test(n)))
    .map((j) => ({ date: j.date, reg: j.reg, vehicle: j.vehicle, job: j.names.join(" + ") || "Job not set" }));

  const weeks = [
    { title: `This week (from ${fmt(today)})`, jobs: jobs.filter((j) => j.date < weekTwoStart) },
    { title: `Next week (from ${fmt(weekTwoStart)})`, jobs: jobs.filter((j) => j.date >= weekTwoStart) },
  ];
  return { weeks, total: jobs.length };
}
