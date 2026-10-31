import "server-only";
import { supabaseAdmin } from "./supabaseAdmin";

// JLR Ingenium customers get their own availability on the public booking page:
// every day without an Ingenium car already coming in is open, with no minimum
// notice. Slots per weekday (JS getUTCDay: 0 = Sunday) — 1 each Mon–Thu, 3 on
// Friday, 1 on Saturday = 8 a week.
const INGENIUM_SLOTS_BY_WEEKDAY = { 0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 3, 6: 1 };

export const ingeniumSlotsFor = (iso) => INGENIUM_SLOTS_BY_WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()] ?? 0;

const MOT_SCOPE = "https://tapi.dvsa.gov.uk/.default";
const normalizeReg = (reg) => (reg || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

// Same matching as the "JLR Ingenium 2.0 diesel/petrol" entries in
// app/api/office/belt-or-chain/route.js: Land Rover/Jaguar, 2.0 (1990–2000cc),
// petrol or diesel, registered 2015 or later. The MOT History API doesn't return
// an engine code, only make/fuel/cc/date, so this is the closest it gets.
function isIngeniumVehicle(vehicle) {
  const make = (vehicle.make || "").toUpperCase();
  if (!["LAND ROVER", "JAGUAR"].some((m) => make.includes(m))) return false;
  if (!["DIESEL", "PETROL"].includes((vehicle.fuelType || "").toUpperCase())) return false;
  const cc = parseInt(vehicle.engineSize, 10);
  if (Number.isNaN(cc) || cc < 1990 || cc > 2000) return false;
  const dateField = vehicle.registrationDate || vehicle.manufactureDate;
  const year = dateField ? parseInt(dateField.split("-")[0], 10) : parseInt(vehicle.manufactureYear, 10);
  return Number.isNaN(year) ? true : year >= 2015 && year <= 2026;
}

// "yes" / "no" / "unknown" — unknown means we couldn't look it up (no MOT
// history yet for a very new car, credentials missing, API down). Callers carry
// on rather than blocking the customer.
export async function checkIngenium(reg) {
  const cleanReg = normalizeReg(reg);
  const { MOT_TENANT_ID, MOT_CLIENT_ID, MOT_CLIENT_SECRET, MOT_API_KEY } = process.env;
  if (!cleanReg || !MOT_TENANT_ID || !MOT_CLIENT_ID || !MOT_CLIENT_SECRET || !MOT_API_KEY) return { status: "unknown" };
  try {
    const tokenRes = await fetch(`https://login.microsoftonline.com/${MOT_TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: MOT_CLIENT_ID, client_secret: MOT_CLIENT_SECRET, scope: MOT_SCOPE }),
    });
    if (!tokenRes.ok) return { status: "unknown" };
    const { access_token } = await tokenRes.json();
    const res = await fetch(`https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(cleanReg)}`, {
      headers: { Authorization: `Bearer ${access_token}`, "X-API-Key": MOT_API_KEY },
    });
    if (res.status === 404) return { status: "unknown" };
    if (!res.ok) return { status: "unknown" };
    const vehicle = await res.json();
    return { status: isIngeniumVehicle(vehicle) ? "yes" : "no", make: vehicle.make || null, model: vehicle.model || null };
  } catch (e) {
    console.error("ingenium check failed", e);
    return { status: "unknown" };
  }
}

const isIngeniumName = (name) => /ingenium/i.test(name || "");

// Ingenium cars due in per date: real bookings whose main or extra job is an
// Ingenium job (by drop-off date only — "coming in"), plus pending public
// requests flagged Ingenium that office hasn't accepted yet. Accepted requests
// become real bookings, so they're not counted twice.
export async function ingeniumCountsByDate(start, end) {
  const counts = {};
  const bump = (iso) => { counts[iso] = (counts[iso] || 0) + 1; };

  const { data: jobTypes, error: jtError } = await supabaseAdmin.from("job_types").select("id, name");
  if (jtError) throw jtError;
  const ingeniumIds = new Set((jobTypes || []).filter((j) => isIngeniumName(j.name)).map((j) => j.id));

  const { data: bookings, error: bError } = await supabaseAdmin
    .from("bookings")
    .select("id, date, job_type_id, customer_cancelled")
    .gte("date", start)
    .lte("date", end);
  if (bError) throw bError;
  const live = (bookings || []).filter((b) => !b.customer_cancelled);
  let extrasByBooking = {};
  if (live.length > 0) {
    const { data: extras } = await supabaseAdmin.from("booking_job_types").select("booking_id, job_type_id").in("booking_id", live.map((b) => b.id));
    (extras || []).forEach((e) => { (extrasByBooking[e.booking_id] ||= []).push(e.job_type_id); });
  }
  live.forEach((b) => {
    if (ingeniumIds.has(b.job_type_id) || (extrasByBooking[b.id] || []).some((id) => ingeniumIds.has(id))) bump(b.date);
  });

  // is_ingenium only exists once migration 065 has run — until then fall back
  // to spotting an Ingenium job in the request's requirements.
  let requests;
  const withFlag = await supabaseAdmin.from("booking_requests").select("date, requirements, is_ingenium").eq("status", "pending").gte("date", start).lte("date", end);
  if (withFlag.error) {
    const plain = await supabaseAdmin.from("booking_requests").select("date, requirements").eq("status", "pending").gte("date", start).lte("date", end);
    requests = plain.data || [];
  } else {
    requests = withFlag.data || [];
  }
  requests.forEach((r) => {
    if (r.is_ingenium || (r.requirements || []).some(isIngeniumName)) bump(r.date);
  });

  return counts;
}
