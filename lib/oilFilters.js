import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadPartsContext, bookingBoms } from "@/lib/bookingParts";
import { addDays, dowOf, todayUK } from "@/lib/lecWeekly";

// The weekly oil filter order sheet. Produced on a Saturday it covers the
// Tuesday after through the Monday after that (Sat+3 .. Sat+9): Monday is
// included so that if the order doesn't arrive on the Monday there are still
// filters on the shelf for every car. The previous Saturday's sheet covered the
// Monday before, so nothing falls between the two.
export const oilFilterWindow = (today = todayUK()) => {
  const sat = addDays(today, (6 - dowOf(today) + 7) % 7); // this Saturday, or today if it is one
  return { start: addDays(sat, 3), end: addDays(sat, 9) };
};

// One row per job coming in that window (Ingenium included — this is our own
// ordering, not the supplier list), with the oil filter(s) its recipe uses, as
// the Weekly parts list "filters" printout does. `totals` rolls the same filters
// up by part so the order quantity is clear.
export async function buildOilFilterList({ today = todayUK() } = {}) {
  const { start, end } = oilFilterWindow(today);
  const { data: bookings, error } = await supabaseAdmin
    .from("bookings")
    .select("id, date, reg, vehicle_model, job_type_id, provisional, customer_cancelled, workshop_completed, completed")
    .gte("date", start).lte("date", end).eq("customer_cancelled", false).order("date");
  if (error) throw error;
  const live = bookings.filter((b) => !b.provisional && !b.completed && !b.workshop_completed);
  const boms = await bookingBoms(live, await loadPartsContext());

  const rows = live.map((b) => {
    const bom = boms.get(b.id);
    return {
      date: b.date,
      reg: b.reg || "—",
      vehicle: b.vehicle_model || "—",
      job: (bom?.jobNames || []).join(" + ") || "Job not set",
      filters: (bom?.lines || []).filter((l) => /oil filter/i.test(l.name)),
    };
  });

  const byPart = {};
  rows.forEach((r) => r.filters.forEach((f) => {
    const t = (byPart[f.partId] ||= { name: f.name, partNumber: f.partNumber, need: 0, stock: f.stock, regs: [] });
    t.need += f.qty;
    t.regs.push(r.reg);
  }));
  const totals = Object.values(byPart)
    .map((t) => ({ ...t, toOrder: Math.max(0, +(t.need - t.stock).toFixed(2)) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    start, end, rows, totals,
    filterCount: totals.reduce((n, t) => n + t.need, 0),
    noFilterCount: rows.filter((r) => r.filters.length === 0).length,
  };
}
