import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Server-side twin of fullBookingBom() in components/WorkshopHub.jsx: the parts a
// booking needs = main + extra job types' recipes, plus one-off extra parts,
// with any per-booking quantity override winning outright. Labour Hours is a
// time charge, not a part to pick, so it's left out.
const isLabour = (name) => /^labour hours$/i.test((name || "").trim());

export async function loadPartsContext() {
  const [jtp, parts, jobTypes] = await Promise.all([
    supabaseAdmin.from("job_type_parts").select("job_type_id, part_id, qty"),
    supabaseAdmin.from("parts").select("id, name, unit, stock, part_number"),
    supabaseAdmin.from("job_types").select("id, name"),
  ]);
  for (const r of [jtp, parts, jobTypes]) if (r.error) throw r.error;
  const bomByJobType = {};
  jtp.data.forEach((l) => { (bomByJobType[l.job_type_id] ||= []).push({ partId: l.part_id, qty: Number(l.qty) }); });
  return {
    bomByJobType,
    partById: Object.fromEntries(parts.data.map((p) => [p.id, { id: p.id, name: p.name, unit: p.unit, stock: Number(p.stock) || 0, partNumber: p.part_number || "" }])),
    jobTypeName: Object.fromEntries(jobTypes.data.map((j) => [j.id, j.name])),
  };
}

// bookings: rows from the `bookings` table (id, job_type_id, …). Returns a Map
// of booking id -> { jobNames: [...], lines: [{ partId, qty, name, unit, stock, partNumber }] }.
export async function bookingBoms(bookings, ctx) {
  const out = new Map();
  if (bookings.length === 0) return out;
  const ids = bookings.map((b) => b.id);
  const [extraJobs, extraParts, overrides] = await Promise.all([
    supabaseAdmin.from("booking_job_types").select("booking_id, job_type_id").in("booking_id", ids),
    supabaseAdmin.from("booking_extra_parts").select("booking_id, part_id, qty").in("booking_id", ids),
    supabaseAdmin.from("booking_bom_qty_overrides").select("booking_id, part_id, qty").in("booking_id", ids),
  ]);
  for (const r of [extraJobs, extraParts, overrides]) if (r.error) throw r.error;
  const by = (rows) => { const m = {}; (rows || []).forEach((r) => { (m[r.booking_id] ||= []).push(r); }); return m; };
  const jobsBy = by(extraJobs.data), extrasBy = by(extraParts.data), overBy = by(overrides.data);

  for (const b of bookings) {
    const jobTypeIds = [b.job_type_id, ...(jobsBy[b.id] || []).map((r) => r.job_type_id)].filter(Boolean);
    const qty = {};
    jobTypeIds.forEach((id) => (ctx.bomByJobType[id] || []).forEach((l) => { qty[l.partId] = (qty[l.partId] || 0) + l.qty; }));
    (extrasBy[b.id] || []).forEach((l) => { qty[l.part_id] = (qty[l.part_id] || 0) + Number(l.qty); });
    (overBy[b.id] || []).forEach((l) => { qty[l.part_id] = Number(l.qty); });
    const lines = Object.entries(qty)
      .filter(([, q]) => q > 0)
      .map(([partId, q]) => {
        const p = ctx.partById[partId];
        return { partId, qty: q, name: p?.name || partId, unit: p?.unit || "", stock: p?.stock ?? 0, partNumber: p?.partNumber || "" };
      })
      .filter((l) => !isLabour(l.name));
    out.set(b.id, { jobNames: jobTypeIds.map((id) => ctx.jobTypeName[id]).filter(Boolean), lines });
  }
  return out;
}
