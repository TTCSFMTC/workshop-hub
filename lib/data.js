import { supabase } from "./supabaseClient";

// ============================================================
// Row <-> app-shape mapping
//
// The app (ported straight from the original prototype) works in camelCase
// objects, e.g. booking.customerName, jobType.bom, jobCard.jobStatus. These
// helpers are the only place that knows about the snake_case Postgres schema
// in supabase/schema.sql, so the rest of the app never has to change again
// if the schema changes.
// ============================================================

const partFromRow = (r) => ({ id: r.id, name: r.name, unit: r.unit, stock: Number(r.stock), costPrice: Number(r.cost_price) });
const partToRow = (p) => ({ id: p.id, name: p.name, unit: p.unit, stock: p.stock, cost_price: p.costPrice });

const bookingFromRow = (r) => ({
  id: r.id, business: r.business, customerName: r.customer_name, phone: r.phone, reg: r.reg,
  symptoms: r.symptoms, jobTypeId: r.job_type_id, date: r.date, pickupRequired: r.pickup_required,
  pickupAddress: r.pickup_address, postcode: r.postcode, distanceMiles: r.distance_miles === null ? null : Number(r.distance_miles),
  jobValue: Number(r.job_value), labourCost: Number(r.labour_cost), transportCost: Number(r.transport_cost),
  createdAt: new Date(r.created_at).getTime(),
});
const bookingToRow = (b) => ({
  id: b.id, business: b.business, customer_name: b.customerName, phone: b.phone, reg: b.reg,
  symptoms: b.symptoms, job_type_id: b.jobTypeId, date: b.date, pickup_required: b.pickupRequired,
  pickup_address: b.pickupAddress, postcode: b.postcode, distance_miles: b.distanceMiles,
  job_value: b.jobValue, labour_cost: b.labourCost, transport_cost: b.transportCost,
});

const settingsFromRow = (r) => ({
  workshopPostcode: r.workshop_postcode, vatRegistered: r.vat_registered,
  collectionInfoUrl: r.collection_info_url, transportCompanies: r.transport_companies,
});
const settingsToRow = (s) => ({
  workshop_postcode: s.workshopPostcode, vat_registered: s.vatRegistered,
  collection_info_url: s.collectionInfoUrl, transport_companies: s.transportCompanies,
});

const jobCardFromRow = (r) => ({
  id: r.id, bookingId: r.booking_id, business: r.business, createdAt: new Date(r.created_at).getTime(),
  dateIn: r.date_in || "", dateOut: r.date_out || "", technician: r.technician,
  make: r.make, model: r.model, reg: r.reg, vin: r.vin, transmission: r.transmission, drive: r.drive,
  mileageIn: r.mileage_in, mileageOut: r.mileage_out,
  customerName: r.customer_name, contact: r.contact, email: r.email,
  jobStatus: r.job_status, authRefNotes: r.auth_ref_notes, symptoms: r.symptoms,
  technicianInterpretation: r.technician_interpretation, preDiagnostic: r.pre_diagnostic,
  diagnosisFindings: r.diagnosis_findings, postDiagnostic: r.post_diagnostic, postChecks: r.post_checks,
  videoLog: r.video_log, signature: r.signature, signatureName: r.signature_name,
  signatureDate: r.signature_date, locked: r.locked,
});
const jobCardToRow = (c) => ({
  id: c.id, booking_id: c.bookingId, business: c.business,
  date_in: c.dateIn || null, date_out: c.dateOut || null, technician: c.technician,
  make: c.make, model: c.model, reg: c.reg, vin: c.vin, transmission: c.transmission, drive: c.drive,
  mileage_in: c.mileageIn, mileage_out: c.mileageOut,
  customer_name: c.customerName, contact: c.contact, email: c.email,
  job_status: c.jobStatus, auth_ref_notes: c.authRefNotes, symptoms: c.symptoms,
  technician_interpretation: c.technicianInterpretation, pre_diagnostic: c.preDiagnostic,
  diagnosis_findings: c.diagnosisFindings, post_diagnostic: c.postDiagnostic, post_checks: c.postChecks,
  video_log: c.videoLog, signature: c.signature, signature_name: c.signatureName,
  signature_date: c.signatureDate, locked: c.locked,
});

function must(error) {
  if (error) throw error;
}

// ---- fetch ----
export async function fetchParts() {
  const { data, error } = await supabase.from("parts").select("*").order("name");
  must(error);
  return data.map(partFromRow);
}

export async function fetchJobTypes() {
  const [{ data: jt, error: e1 }, { data: jtp, error: e2 }] = await Promise.all([
    supabase.from("job_types").select("*").order("name"),
    supabase.from("job_type_parts").select("*"),
  ]);
  must(e1); must(e2);
  return jt.map((row) => ({
    id: row.id,
    name: row.name,
    bom: jtp.filter((l) => l.job_type_id === row.id).map((l) => ({ partId: l.part_id, qty: Number(l.qty) })),
  }));
}

export async function fetchBookings() {
  const { data, error } = await supabase.from("bookings").select("*").order("date");
  must(error);
  return data.map(bookingFromRow);
}

export async function fetchJobCards() {
  const { data, error } = await supabase.from("job_cards").select("*").order("created_at", { ascending: false });
  must(error);
  return data.map(jobCardFromRow);
}

export async function fetchSettings() {
  const { data, error } = await supabase.from("settings").select("*").eq("id", true).maybeSingle();
  must(error);
  return data ? settingsFromRow(data) : null;
}

export async function fetchAll() {
  const [parts, jobTypes, bookings, jobCards, settings] = await Promise.all([
    fetchParts(), fetchJobTypes(), fetchBookings(), fetchJobCards(), fetchSettings(),
  ]);
  return { parts, jobTypes, bookings, jobCards, settings };
}

// ---- parts ----
export async function insertPart(part) {
  const { error } = await supabase.from("parts").insert(partToRow(part));
  must(error);
}
export async function updatePart(id, patch) {
  const row = {};
  if ("name" in patch) row.name = patch.name;
  if ("unit" in patch) row.unit = patch.unit;
  if ("stock" in patch) row.stock = patch.stock;
  if ("costPrice" in patch) row.cost_price = patch.costPrice;
  const { error } = await supabase.from("parts").update(row).eq("id", id);
  must(error);
}

// ---- job types & recipe lines ----
export async function insertJobType(jobType) {
  const { error } = await supabase.from("job_types").insert({ id: jobType.id, name: jobType.name });
  must(error);
}
export async function renameJobType(id, name) {
  const { error } = await supabase.from("job_types").update({ name }).eq("id", id);
  must(error);
}
export async function addBomLine(jobTypeId, partId, qty) {
  const { error } = await supabase.from("job_type_parts").upsert({ job_type_id: jobTypeId, part_id: partId, qty });
  must(error);
}
export async function updateBomLine(jobTypeId, partId, qty) {
  const { error } = await supabase.from("job_type_parts").update({ qty }).eq("job_type_id", jobTypeId).eq("part_id", partId);
  must(error);
}
export async function removeBomLine(jobTypeId, partId) {
  const { error } = await supabase.from("job_type_parts").delete().eq("job_type_id", jobTypeId).eq("part_id", partId);
  must(error);
}

// ---- settings (single row) ----
export async function saveSettings(settings) {
  const { error } = await supabase.from("settings").update(settingsToRow(settings)).eq("id", true);
  must(error);
}

// ---- bookings ----
export async function insertBooking(booking) {
  const { error } = await supabase.from("bookings").insert(bookingToRow(booking));
  must(error);
}
export async function updateBookingRow(id, patch) {
  const row = {};
  const map = {
    customerName: "customer_name", jobTypeId: "job_type_id", pickupRequired: "pickup_required",
    pickupAddress: "pickup_address", distanceMiles: "distance_miles", jobValue: "job_value",
    labourCost: "labour_cost", transportCost: "transport_cost",
  };
  for (const [key, val] of Object.entries(patch)) row[map[key] || key] = val;
  const { error } = await supabase.from("bookings").update(row).eq("id", id);
  must(error);
}
export async function deleteBookingRow(id) {
  const { error } = await supabase.from("bookings").delete().eq("id", id);
  must(error);
}

// ---- job cards ----
export async function upsertJobCardRow(card) {
  const { error } = await supabase.from("job_cards").upsert(jobCardToRow(card));
  must(error);
}
export async function updateJobCardRow(id, patch) {
  const map = {
    bookingId: "booking_id", dateIn: "date_in", dateOut: "date_out", mileageIn: "mileage_in",
    mileageOut: "mileage_out", customerName: "customer_name", jobStatus: "job_status",
    authRefNotes: "auth_ref_notes", technicianInterpretation: "technician_interpretation",
    preDiagnostic: "pre_diagnostic", diagnosisFindings: "diagnosis_findings",
    postDiagnostic: "post_diagnostic", postChecks: "post_checks", videoLog: "video_log",
    signatureName: "signature_name", signatureDate: "signature_date",
  };
  const row = {};
  for (const [key, val] of Object.entries(patch)) row[map[key] || key] = val;
  const { error } = await supabase.from("job_cards").update(row).eq("id", id);
  must(error);
}

// ---- realtime ----
// Subscribes to every change on `table` and calls `onChange` so the caller
// can re-fetch that slice. Data volumes here are small (single workshop),
// so "any change -> refetch the table" is simpler and more robust than
// diffing individual row events, at negligible cost.
export function subscribeTable(table, onChange) {
  const channel = supabase
    .channel(`${table}-changes`)
    .on("postgres_changes", { event: "*", schema: "public", table }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
