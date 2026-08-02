import "server-only";
import { supabaseAdmin } from "./supabaseAdmin";

// The two technicians whose holidays actually affect how many jobs a day
// can take — matched against the free-text `name` field on a holiday (which
// can be a single name or several, e.g. "Ervin, Ernesto" for a day they're
// both off together), not a separate table per person.
const TECHS = ["Ernesto", "Ervin"];

// Which of the two technicians are on holiday for a given date — used to
// shrink (or zero out) that day's public-booking capacity automatically,
// rather than office having to remember to check the Holidays tab every
// time a request comes in.
export async function techsOffOn(date) {
  const { data, error } = await supabaseAdmin
    .from("holidays")
    .select("name, date_from, date_to")
    .lte("date_from", date)
    .gte("date_to", date);
  if (error) throw error;
  const off = new Set();
  (data || []).forEach((h) => {
    TECHS.forEach((t) => { if ((h.name || "").toLowerCase().includes(t.toLowerCase())) off.add(t); });
  });
  return [...off];
}

// Both off: nobody to do the work, so the day has no capacity at all —
// this naturally makes it show as fully booked/blocked rather than needing
// a separate "closed" state. One off: only one pair of hands, so cap at 2
// regardless of what the normal daily cap would otherwise allow.
export function capForTechsOff(offCount, baseCap) {
  if (offCount >= 2) return 0;
  if (offCount === 1) return Math.min(baseCap, 2);
  return baseCap;
}
