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

const partFromRow = (r) => ({ id: r.id, name: r.name, unit: r.unit, stock: Number(r.stock), costPrice: Number(r.cost_price), partNumber: r.part_number || "" });
const partToRow = (p) => ({ id: p.id, name: p.name, unit: p.unit, stock: p.stock, cost_price: p.costPrice, part_number: p.partNumber || null });

const priceHistoryFromRow = (r) => ({
  id: r.id, partId: r.part_id, price: Number(r.price), qty: r.qty === null ? null : Number(r.qty),
  supplier: r.supplier, recordedAt: r.recorded_at,
});

const stockBatchFromRow = (r) => ({
  id: r.id, partId: r.part_id, qtyOrdered: Number(r.qty_ordered), qtyRemaining: Number(r.qty_remaining),
  price: Number(r.price), supplier: r.supplier || "", status: r.status,
  orderedAt: r.ordered_at, deliveredAt: r.delivered_at, dueDate: r.due_date || null,
});

const bookingFromRow = (r) => ({
  id: r.id, business: r.business, customerName: r.customer_name, phone: r.phone, reg: r.reg,
  symptoms: r.symptoms, jobTypeId: r.job_type_id, date: r.date, days: Number(r.days ?? 1), pickupRequired: r.pickup_required,
  pickupAddress: r.pickup_address, postcode: r.postcode, distanceMiles: r.distance_miles === null ? null : Number(r.distance_miles),
  jobValue: Number(r.job_value), labourCost: Number(r.labour_cost), transportCost: Number(r.transport_cost),
  createdAt: new Date(r.created_at).getTime(), googleEventId: r.google_event_id, vehicleModel: r.vehicle_model || "",
  completed: r.completed ?? false, reminderSent: r.reminder_sent ?? false, transportRequired: r.transport_required ?? false,
  completedAt: r.completed_at ? new Date(r.completed_at).getTime() : null, followupSent: r.followup_sent ?? false,
  reviewFollowupDone: r.review_followup_done ?? false,
  zohoInvoiceId: r.zoho_invoice_id || null, zohoInvoiceNumber: r.zoho_invoice_number || null, zohoInvoiceUrl: r.zoho_invoice_url || null,
  workshopCompleted: r.workshop_completed ?? false, workshopCompletedAt: r.workshop_completed_at ? new Date(r.workshop_completed_at).getTime() : null,
  arrived: r.arrived ?? false, arrivedAt: r.arrived_at ? new Date(r.arrived_at).getTime() : null,
});
const bookingToRow = (b) => ({
  id: b.id, business: b.business, customer_name: b.customerName, phone: b.phone, reg: b.reg,
  symptoms: b.symptoms, job_type_id: b.jobTypeId, date: b.date, days: b.days ?? 1, pickup_required: b.pickupRequired,
  pickup_address: b.pickupAddress, postcode: b.postcode, distance_miles: b.distanceMiles,
  job_value: b.jobValue, labour_cost: b.labourCost, transport_cost: b.transportCost,
  google_event_id: b.googleEventId, vehicle_model: b.vehicleModel || null, completed: b.completed ?? false,
  reminder_sent: b.reminderSent ?? false, transport_required: b.transportRequired ?? false,
  completed_at: b.completedAt ? new Date(b.completedAt).toISOString() : null, followup_sent: b.followupSent ?? false,
  review_followup_done: b.reviewFollowupDone ?? false,
  zoho_invoice_id: b.zohoInvoiceId || null, zoho_invoice_number: b.zohoInvoiceNumber || null, zoho_invoice_url: b.zohoInvoiceUrl || null,
  workshop_completed: b.workshopCompleted ?? false, workshop_completed_at: b.workshopCompletedAt ? new Date(b.workshopCompletedAt).toISOString() : null,
  arrived: b.arrived ?? false, arrived_at: b.arrivedAt ? new Date(b.arrivedAt).toISOString() : null,
});

const settingsFromRow = (r) => ({
  workshopPostcode: r.workshop_postcode, vatRegistered: r.vat_registered,
  collectionInfoUrl: r.collection_info_url, transportCompanies: r.transport_companies,
  transportContactName: r.transport_contact_name || "Paul", transportContactPhone: r.transport_contact_phone || "",
});
const settingsToRow = (s) => ({
  workshop_postcode: s.workshopPostcode, vat_registered: s.vatRegistered,
  collection_info_url: s.collectionInfoUrl, transport_companies: s.transportCompanies,
  transport_contact_name: s.transportContactName || "Paul", transport_contact_phone: s.transportContactPhone || "",
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
  signatureDate: r.signature_date, locked: r.locked, completionVideoOverridden: r.completion_video_overridden,
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
  signature_date: c.signatureDate, locked: c.locked, completion_video_overridden: c.completionVideoOverridden ?? false,
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
    color: row.color,
    bom: jtp.filter((l) => l.job_type_id === row.id).map((l) => ({ partId: l.part_id, qty: Number(l.qty) })),
  }));
}

export async function fetchBookings() {
  const [{ data, error }, { data: extras, error: e2 }, { data: extraParts, error: e3 }, { data: jobTypePrices, error: e4 }] = await Promise.all([
    supabase.from("bookings").select("*").order("date"),
    supabase.from("booking_job_types").select("*"),
    supabase.from("booking_extra_parts").select("*"),
    supabase.from("booking_job_type_prices").select("*"),
  ]);
  must(error); must(e2); must(e3); must(e4);
  return data.map((row) => ({
    ...bookingFromRow(row),
    extraJobTypeIds: extras.filter((l) => l.booking_id === row.id).map((l) => l.job_type_id),
    extraParts: extraParts.filter((l) => l.booking_id === row.id).map((l) => ({ partId: l.part_id, qty: Number(l.qty) })),
    jobTypePrices: jobTypePrices.filter((l) => l.booking_id === row.id).map((l) => ({ jobTypeId: l.job_type_id, price: Number(l.price) })),
  }));
}

export async function fetchPriceHistory() {
  const { data, error } = await supabase.from("part_price_history").select("*").order("recorded_at");
  must(error);
  return data.map(priceHistoryFromRow);
}

export async function fetchStockBatches() {
  const { data, error } = await supabase.from("stock_batches").select("*").order("ordered_at");
  must(error);
  return data.map(stockBatchFromRow);
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
  const [parts, jobTypes, bookings, jobCards, settings, priceHistory, stockBatches] = await Promise.all([
    fetchParts(), fetchJobTypes(), fetchBookings(), fetchJobCards(), fetchSettings(), fetchPriceHistory(), fetchStockBatches(),
  ]);
  return { parts, jobTypes, bookings, jobCards, settings, priceHistory, stockBatches };
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
  if ("partNumber" in patch) row.part_number = patch.partNumber || null;
  const { error } = await supabase.from("parts").update(row).eq("id", id);
  must(error);
}
export async function deletePart(id) {
  const { error } = await supabase.from("parts").delete().eq("id", id);
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
export async function updateJobTypeColor(id, color) {
  const { error } = await supabase.from("job_types").update({ color }).eq("id", id);
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
// Fields the app stores as epoch-ms numbers but the DB stores as timestamptz
// — patches touching these must be converted to ISO strings, or PostgREST
// rejects the whole row update with a 400 (date/time field value out of range).
const BOOKING_ROW_DATE_KEYS = new Set(["completedAt", "workshopCompletedAt", "arrivedAt"]);

export async function updateBookingRow(id, patch) {
  const row = {};
  const map = {
    customerName: "customer_name", jobTypeId: "job_type_id", pickupRequired: "pickup_required",
    pickupAddress: "pickup_address", distanceMiles: "distance_miles", jobValue: "job_value",
    labourCost: "labour_cost", transportCost: "transport_cost", googleEventId: "google_event_id",
    vehicleModel: "vehicle_model", reminderSent: "reminder_sent", transportRequired: "transport_required",
    completedAt: "completed_at", followupSent: "followup_sent", reviewFollowupDone: "review_followup_done",
    zohoInvoiceId: "zoho_invoice_id", zohoInvoiceNumber: "zoho_invoice_number", zohoInvoiceUrl: "zoho_invoice_url",
    workshopCompleted: "workshop_completed", workshopCompletedAt: "workshop_completed_at",
    arrived: "arrived", arrivedAt: "arrived_at",
  };
  for (const [key, val] of Object.entries(patch)) {
    row[map[key] || key] = BOOKING_ROW_DATE_KEYS.has(key) && val != null ? new Date(val).toISOString() : val;
  }
  const { error } = await supabase.from("bookings").update(row).eq("id", id);
  must(error);
}
export async function deleteBookingRow(id) {
  const { error } = await supabase.from("bookings").delete().eq("id", id);
  must(error);
}

// ---- booking extra job types ----
export async function addBookingJobType(bookingId, jobTypeId) {
  const { error } = await supabase.from("booking_job_types").upsert({ booking_id: bookingId, job_type_id: jobTypeId });
  must(error);
}
export async function removeBookingJobType(bookingId, jobTypeId) {
  const { error } = await supabase.from("booking_job_types").delete().eq("booking_id", bookingId).eq("job_type_id", jobTypeId);
  must(error);
}

// ---- booking extra individual parts ----
export async function setBookingExtraPart(bookingId, partId, qty) {
  const { error } = await supabase.from("booking_extra_parts").upsert({ booking_id: bookingId, part_id: partId, qty });
  must(error);
}
export async function removeBookingExtraPart(bookingId, partId) {
  const { error } = await supabase.from("booking_extra_parts").delete().eq("booking_id", bookingId).eq("part_id", partId);
  must(error);
}

// ---- per-job-type price breakdown ----
export async function setBookingJobTypePrice(bookingId, jobTypeId, price) {
  const { error } = await supabase.from("booking_job_type_prices").upsert({ booking_id: bookingId, job_type_id: jobTypeId, price });
  must(error);
}
export async function removeBookingJobTypePrice(bookingId, jobTypeId) {
  const { error } = await supabase.from("booking_job_type_prices").delete().eq("booking_id", bookingId).eq("job_type_id", jobTypeId);
  must(error);
}

// ---- part price history ----
export async function insertPriceHistory(entry) {
  const { error } = await supabase.from("part_price_history").insert({
    id: entry.id, part_id: entry.partId, price: entry.price, qty: entry.qty, supplier: entry.supplier || null, recorded_at: entry.recordedAt,
  });
  must(error);
}
export async function deletePriceHistory(id) {
  const { error } = await supabase.from("part_price_history").delete().eq("id", id);
  must(error);
}

// ---- stock batches (FIFO-priced ordering + delivery) ----
export async function insertStockBatch(batch) {
  const { error } = await supabase.from("stock_batches").insert({
    id: batch.id, part_id: batch.partId, qty_ordered: batch.qtyOrdered, qty_remaining: batch.qtyRemaining,
    price: batch.price, supplier: batch.supplier || null, status: batch.status,
    ordered_at: batch.orderedAt, delivered_at: batch.deliveredAt || null, due_date: batch.dueDate || null,
  });
  must(error);
}
export async function updateStockBatchQtyRemaining(id, qtyRemaining) {
  const { error } = await supabase.from("stock_batches").update({ qty_remaining: qtyRemaining }).eq("id", id);
  must(error);
}
export async function markStockBatchDelivered(id, deliveredAt) {
  const { error } = await supabase.from("stock_batches").update({ status: "delivered", delivered_at: deliveredAt }).eq("id", id);
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
    signatureName: "signature_name", signatureDate: "signature_date", completionVideoOverridden: "completion_video_overridden",
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
