"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar, Plus, ClipboardPaste, Package, Wrench, AlertTriangle, X, ChevronLeft, ChevronRight,
  MapPin, Phone, Car, FileText, Truck, Settings as SettingsIcon, ListChecks, Check, TrendingDown, TrendingUp,
  Mail, PoundSterling, Search, ArrowLeft, Mic, MicOff, PenLine, RotateCcw, Lock,
  User, Building2, LayoutGrid, LogOut, Inbox, ThumbsDown, MessageCircle, History, Minus, List, Trash2, Printer,
} from "lucide-react";
import {
  fetchAll, fetchParts, fetchJobTypes, fetchBookings, fetchJobCards, fetchJobApprovals, fetchSettings, fetchPriceHistory, fetchStockBatches,
  insertPart, updatePart, deletePart, insertJobType, renameJobType, updateJobTypeColor, addBomLine, updateBomLine, removeBomLine,
  saveSettings, insertBooking, updateBookingRow, deleteBookingRow, addBookingJobType, removeBookingJobType,
  setBookingExtraPart, removeBookingExtraPart, setBookingJobTypePrice, removeBookingJobTypePrice, setBookingBomQtyOverride, removeBookingBomQtyOverride,
  upsertJobCardRow, updateJobCardRow, deleteJobCardRow,
  insertPriceHistory, deletePriceHistory, insertStockBatch, updateStockBatchQtyRemaining, markStockBatchDelivered,
  insertJobApproval, updateJobApprovalRow, deleteJobApproval,
  subscribeTable,
} from "@/lib/data";
import { CALENDAR_COLORS } from "@/lib/calendarColors";
import { BUSINESSES, REVIEW_LINKS } from "@/lib/constants";
import * as XLSX from "xlsx";

// ============================================================
// Shared constants & helpers
// ============================================================
const REORDER_WEEKS = 1;

// Which thermostat housing a model takes — lets the booking form pick the
// right stock part automatically instead of staff having to remember which
// of the two look-alike parts fits which model.
const THERMOSTAT_MODEL_MAP = {
  "Range Rover Evoque": "p_thermostat_housing_a",
  "Land Rover Discovery Sport": "p_thermostat_housing_a",
  "Jaguar E-Pace": "p_thermostat_housing_a",
  "Range Rover Velar": "p_thermostat_housing_b",
  "Jaguar F-Pace": "p_thermostat_housing_b",
  "Jaguar XE": "p_thermostat_housing_b",
  "Jaguar XF": "p_thermostat_housing_b",
  "Land Rover Discovery 5": "p_thermostat_housing_b",
};
const VEHICLE_MODELS = Object.keys(THERMOSTAT_MODEL_MAP);
const uid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};
// Pure calendar-day arithmetic, done entirely in UTC so it can't be thrown off
// by the browser's local timezone/DST (e.g. BST parsing "T00:00:00" as local
// midnight, which is the previous day in UTC — shifting every date by one).
const addDaysISO = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
// Every calendar day a multi-day booking spans, e.g. days=3 from 2026-07-08 -> [07-08, 07-09, 07-10].
const bookingDates = (b) => Array.from({ length: b.days || 1 }, (_, i) => addDaysISO(b.date, i));

// ============================================================
// Stock batches — FIFO cost basis
//
// A part's stock/cost price is derived from its delivered batches, oldest
// first, rather than stored directly: an existing cheaper batch keeps being
// "the" reported cost price until it's actually used up, then the next
// batch takes over. Parts that have never had a delivered batch (brand new,
// never ordered) fall back to their raw (zero) stock/costPrice.
// ============================================================
function derivePartFromBatches(part, batches) {
  const allDelivered = batches.filter((b) => b.partId === part.id && b.status === "delivered").sort((a, b) => (a.deliveredAt < b.deliveredAt ? -1 : 1));
  if (allDelivered.length === 0) return part;
  const active = allDelivered.filter((b) => b.qtyRemaining > 0);
  const stock = +allDelivered.reduce((sum, b) => sum + b.qtyRemaining, 0).toFixed(2);
  const costPrice = active.length > 0 ? active[0].price : allDelivered[allDelivered.length - 1].price;
  return { ...part, stock, costPrice };
}
// Deducting qty from a part's stock (booking created, or edited to use
// more) — walks delivered batches oldest-first, splitting across batches if
// one alone doesn't cover it. Returns the {batchId, qtyRemaining} writes
// needed; doesn't go negative if the request exceeds what's tracked.
function allocateFIFO(batches, partId, qty) {
  const active = batches.filter((b) => b.partId === partId && b.status === "delivered" && b.qtyRemaining > 0).sort((a, b) => (a.deliveredAt < b.deliveredAt ? -1 : 1));
  const updates = [];
  let remaining = qty;
  for (const b of active) {
    if (remaining <= 0) break;
    const take = Math.min(b.qtyRemaining, remaining);
    updates.push({ batchId: b.id, qtyRemaining: +(b.qtyRemaining - take).toFixed(2) });
    remaining = +(remaining - take).toFixed(2);
  }
  return updates;
}
// Returning qty to stock (booking deleted, or edited to use less) — added
// back into the oldest existing delivered batch for that part, since a
// booking doesn't track exactly which batch(es) it originally drew from.
// An approximation, not a perfect lot-reversal, but keeps totals correct.
function returnFIFO(batches, partId, qty) {
  const existing = batches.filter((b) => b.partId === partId && b.status === "delivered").sort((a, b) => (a.deliveredAt < b.deliveredAt ? -1 : 1));
  if (existing.length === 0) return [];
  const b = existing[0];
  return [{ batchId: b.id, qtyRemaining: +(b.qtyRemaining + qty).toFixed(2) }];
}
function applyBatchUpdates(batches, updates) {
  const map = new Map(updates.map((u) => [u.batchId, u.qtyRemaining]));
  return batches.map((b) => (map.has(b.id) ? { ...b, qtyRemaining: map.get(b.id) } : b));
}
// Whole-day difference between two ISO dates (toIso - fromIso), UTC-based like addDaysISO
// so it can't be thrown off by DST.
const daysBetweenISO = (fromIso, toIso) => {
  const [y1, m1, d1] = fromIso.split("-").map(Number);
  const [y2, m2, d2] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};

// Pushes just a date + job-type colour to the public Google Calendar — never
// the customer/vehicle detail this app holds. Failures are logged but never
// block the booking itself; Google being briefly unreachable shouldn't stop
// reception taking a booking.
async function syncBookingToGoogle({ googleEventId, date, days, jobTypeName, colorId }) {
  try {
    const endDate = addDaysISO(date, days || 1);
    const res = await fetch("/api/calendar-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsert", googleEventId, date, endDate, summary: jobTypeName, colorId }),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()).googleEventId;
  } catch (e) {
    console.error("Google Calendar sync failed", e);
    return googleEventId || null;
  }
}
async function deleteBookingFromGoogle(googleEventId) {
  if (!googleEventId) return;
  try {
    await fetch("/api/calendar-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", googleEventId }),
    });
  } catch (e) {
    console.error("Google Calendar delete failed", e);
  }
}

function extractPhone(text) {
  const m = text.match(/(\+44\s?7\d{3}|\b07\d{3})[\s-]?\d{3}[\s-]?\d{3}\b/);
  return m ? m[0].replace(/\s+/g, " ").trim() : "";
}
function extractReg(text) {
  const m = text.match(/\b[A-Z]{2}[0-9]{2}\s?[A-Z]{3}\b/i);
  return m ? m[0].toUpperCase().replace(/\s+/g, " ") : "";
}
function extractEmail(text) {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : "";
}
// UK-only: turns "07911 123456" or "+44 7911 123456" into the digits-only,
// country-code-prefixed form wa.me needs ("447911123456").
function whatsappNumber(phone) {
  let digits = phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (digits.startsWith("0")) digits = "44" + digits.slice(1);
  else if (!digits.startsWith("44")) digits = "44" + digits;
  return digits;
}
const firstName = (name) => (name || "").trim().split(/\s+/)[0] || "there";

function whatsappLink(phone, message) {
  return `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(message)}`;
}

// The record of the agreed price lives in this message, so it's only ever
// sendable once a job value has been entered — callers must check
// booking.jobValue before opening this link.
//
// Timing Chain Specialists customers don't drop the car off with us in
// person — a collection driver handles that end, and we won't be there to
// take the locking wheel nut from them directly — so the closing line has
// to be different from Warrington 4x4's "see you at 9:30am" version.
function confirmationMessage(b) {
  const closing = b.business === "Timing Chain Specialists"
    ? "As your vehicle will be collected rather than dropped off with us in person, please make sure your locking wheel nut is left in the centre cupholder ready for the driver. We'll of course keep in touch with you throughout the work."
    : "We'll be there to greet you on the day — please bring your locking wheel nut (not just the key) with you, and aim to arrive around 9:30am.";
  return `Hi ${firstName(b.customerName)},

Many thanks for sending all that through, and for reading through our terms and conditions.

I can confirm your vehicle is booked in on ${fmtDate(b.date)} for approximately ${b.days || 1} day(s) — that's just an estimate, and we'll keep you updated throughout.

We've agreed a retail price of £${(b.jobValue || 0).toFixed(2)} for this work.

Between now and then, if anything changes or comes up, please just let us know.

${closing}

Many thanks,
${b.business}`;
}

function reminderMessage(b) {
  const reminder = b.business === "Timing Chain Specialists"
    ? "just a reminder, please make sure your locking wheel nut is left in the centre cupholder ready for our collection driver."
    : "just a reminder, please bring your locking wheel nut. We'll meet you in reception at 9:30.";
  return `Hello ${firstName(b.customerName)},

I hope you are well, just checking in before we finalise the details — ${reminder} Just let us know if anything has changed since we booked you in.`;
}

function transportPriceRequestMessage(b, contactName) {
  return `Hi ${firstName(contactName)}, we have a customer wanting a car collecting on ${fmtDate(addDaysISO(b.date, -1))} for a job starting ${fmtDate(b.date)}.

Vehicle: ${b.vehicleModel || "not specified"}
Postcode: ${b.postcode || ""}

Please could you let me know a price and whether you're able to do this?`;
}

function workshopCompletedMessage(b) {
  return `Great news ${firstName(b.customerName)}, your vehicle has been completed! It's ready for collection whenever's convenient for you — just let us know if you have any questions.`;
}

// Sent the moment COMP is ticked — thanks the customer, flags that a brief
// settling-in period (coolant/EML light as residual air clears) is normal
// after major repairs, and asks for a review. Separate from the automated
// 2-day/4-day follow-up nudges, which still run afterward for anyone who
// doesn't respond to this one.
function collectionThankYouMessage(b) {
  const link = REVIEW_LINKS[b.business] || "";
  return `Thank you for choosing ${b.business}! We really appreciate the trust you've placed in us.

After major repairs it's common to see a brief settling-in period — you might notice a coolant or engine management light as residual air works through the system. This is usually normal, but do let us know if you're ever concerned.

We'd recommend servicing every 12 months or 8,000 miles, whichever comes first.

If you were happy with the service, we'd really appreciate a quick Google review: ${link}

Thanks again for your support!`;
}

// Bookings due a 2-days-before reminder: within the next 2 days, originally
// booked with more than 2 days' notice (short-notice bookings never had a
// meaningful "2 days before" window), and not already reminded.
function reminderCandidates(bookings) {
  const today = todayISO();
  return bookings.filter((b) => {
    if (b.reminderSent || !b.phone) return false;
    const daysUntilAppt = daysBetweenISO(today, b.date);
    if (daysUntilAppt < 0 || daysUntilAppt > 2) return false;
    const bookedOn = new Date(b.createdAt).toISOString().slice(0, 10);
    return daysBetweenISO(bookedOn, b.date) > 2;
  });
}

function followUpMessage(b) {
  return `Hi ${firstName(b.customerName)}, just checking in now it's been a couple of days since we finished the work on your vehicle — how's everything running? If all good, we'd really appreciate a quick Google review: ${REVIEW_LINKS[b.business] || ""}. And if anything doesn't feel right, just let us know.`;
}

// Bookings due a post-completion follow-up: marked complete at least 2 days
// ago and not already followed up on. Uses completed_at (stamped when the
// checkbox is ticked) rather than the booking's date/days, since jobs often
// finish early or late relative to the scheduled span.
function followUpCandidates(bookings) {
  const today = todayISO();
  return bookings.filter((b) => {
    if (!b.completed || !b.completedAt || b.followupSent || !b.phone) return false;
    const completedOn = new Date(b.completedAt).toISOString().slice(0, 10);
    return daysBetweenISO(completedOn, today) >= 2;
  });
}

// The dedicated 4-days-later review ask — separate from the 2-day check-in
// above, with its own fixed wording per business.
function reviewFollowUpMessage(b) {
  const link = REVIEW_LINKS[b.business] || "";
  return `Just a friendly reminder to leave us a Google review if you haven't already. ⭐

Your feedback really helps our small family business and gives other Land Rover & Jaguar owners the confidence to choose us.

It only takes a minute, and we genuinely appreciate every review.

Here's the link... ${link}

Thank you for your support! 🚗`;
}

// Bookings due the 4-day review check: marked complete at least 4 days ago
// and not yet resolved (either a reminder was sent, or Office confirmed the
// customer had already left a review).
function reviewFollowUpCandidates(bookings) {
  const today = todayISO();
  return bookings.filter((b) => {
    if (!b.completed || !b.completedAt || b.reviewFollowupDone || !b.phone) return false;
    const completedOn = new Date(b.completedAt).toISOString().slice(0, 10);
    return daysBetweenISO(completedOn, today) >= 4;
  });
}

function guessName(text, phone) {
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) || "";
  const cleaned = firstLine.replace(phone, "").trim();
  if (cleaned.length > 0 && cleaned.length < 40 && !/\d{4,}/.test(cleaned)) return cleaned;
  return "";
}

const POSTCODE_AREA_COORDS = {
  WA: [53.39, -2.60], WN: [53.55, -2.63], PR: [53.76, -2.70], L: [53.41, -2.98], M: [53.48, -2.24],
  SK: [53.33, -2.10], OL: [53.58, -2.12], BL: [53.58, -2.43], BB: [53.75, -2.48], LA: [54.05, -2.80],
  CH: [53.19, -2.89], CW: [53.16, -2.44], ST: [53.00, -2.19], SY: [52.71, -2.75], TF: [52.68, -2.45],
  WV: [52.59, -2.13], DY: [52.49, -2.13], B: [52.48, -1.90], CV: [52.41, -1.51], WS: [52.59, -1.98],
  NG: [52.95, -1.15], DE: [52.92, -1.48], LE: [52.63, -1.13], NN: [52.24, -0.90], PE: [52.57, -0.24],
  CB: [52.20, 0.12], IP: [52.06, 1.16], NR: [52.63, 1.30], CO: [51.89, 0.90], SS: [51.54, 0.71],
  RM: [51.58, 0.18], E: [51.53, -0.04], EC: [51.52, -0.09], WC: [51.52, -0.12], N: [51.57, -0.11],
  NW: [51.55, -0.20], W: [51.51, -0.20], SW: [51.48, -0.16], SE: [51.47, -0.06], EN: [51.65, -0.08],
  HA: [51.58, -0.34], UB: [51.53, -0.44], TW: [51.45, -0.36], KT: [51.35, -0.28], CR: [51.37, -0.10],
  BR: [51.40, 0.05], DA: [51.45, 0.19], SM: [51.36, -0.20], WD: [51.66, -0.42], AL: [51.75, -0.34],
  LU: [51.88, -0.42], MK: [52.04, -0.76], OX: [51.75, -1.26], RG: [51.46, -0.97], SL: [51.51, -0.60],
  GU: [51.24, -0.58], SN: [51.56, -1.78], BA: [51.38, -2.36], BS: [51.45, -2.59], GL: [51.86, -2.24],
  HR: [52.06, -2.72], WR: [52.19, -2.22], TA: [51.02, -3.10], EX: [50.72, -3.53], PL: [50.37, -4.14],
  TR: [50.26, -5.05], DT: [50.71, -2.44], BH: [50.72, -1.88], SP: [51.07, -1.79], SO: [50.91, -1.40],
  PO: [50.80, -1.09], BN: [50.83, -0.14], RH: [51.11, -0.20], TN: [51.13, 0.26], ME: [51.39, 0.55],
  CT: [51.28, 1.08], HP: [51.63, -0.75], CM: [51.74, 0.47], SG: [51.90, -0.20],
  CF: [51.48, -3.18], NP: [51.59, -2.99], SA: [51.62, -3.94], LD: [52.24, -3.38], LL: [53.05, -3.70],
  HG: [54.00, -1.54], LS: [53.80, -1.55], BD: [53.79, -1.75], HX: [53.72, -1.87],
  HD: [53.65, -1.78], WF: [53.68, -1.50], YO: [53.96, -1.08], DN: [53.52, -1.13], S: [53.38, -1.47],
  DL: [54.52, -1.55], TS: [54.57, -1.23], SR: [54.91, -1.38], DH: [54.78, -1.58], NE: [54.98, -1.61],
  CA: [54.89, -2.93], DG: [55.07, -3.60], KA: [55.61, -4.50], G: [55.86, -4.25], PA: [55.85, -4.42],
  EH: [55.95, -3.19], FK: [56.00, -3.78], KY: [56.20, -3.16], DD: [56.46, -2.97], AB: [57.15, -2.10],
  IV: [57.48, -4.22], PH: [56.70, -3.90], TD: [55.60, -2.78], ML: [55.78, -3.99], BT: [54.60, -5.93],
};
function postcodeArea(pc) {
  if (!pc) return null;
  const m = pc.toUpperCase().replace(/\s+/g, "").match(/^([A-Z]{1,2})[0-9]/);
  return m ? m[1] : null;
}
function estimateDistanceMiles(fromPostcode, toPostcode) {
  const a = postcodeArea(fromPostcode), b = postcodeArea(toPostcode);
  const fromCoord = a && POSTCODE_AREA_COORDS[a], toCoord = b && POSTCODE_AREA_COORDS[b];
  if (!fromCoord || !toCoord) return null;
  const [lat1, lon1] = fromCoord, [lat2, lon2] = toCoord;
  const R = 3958.8, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.15);
}

const DEFAULT_SETTINGS = {
  workshopPostcode: "WA1",
  vatRegistered: false,
  collectionInfoUrl: "",
  transportCompanies: [{ name: "Transport company 1", email: "" }, { name: "Transport company 2", email: "" }],
  transportContactName: "Paul",
  transportContactPhone: "",
};

// Standard pricing for a Timing Chain Replacement — pre-filled on new
// bookings of this job type, and offered as a one-click fix for existing
// bookings of this type that were never priced.
const STANDARD_TIMING_CHAIN_PRICE = { jobValue: 1495, labourCost: 220 };
const isTimingChainReplacement = (jt) => jt?.name === "Timing Chain Replacement";

// Vehicle model on a booking is one free-text field (e.g. "Jaguar F Pace")
// — split it so the job card's separate Make/Model boxes start pre-filled
// instead of blank. Checked against known multi-word makes first (this is
// a JLR specialist, so "Land Rover" turning into make "Land" would be a
// constant annoyance, not a rare edge case) before falling back to a
// first-word split; still just a starting guess the technician can correct.
const MULTI_WORD_MAKES = ["Land Rover", "Alfa Romeo", "Aston Martin", "Rolls Royce"];
const guessMakeModel = (vehicleModel) => {
  const trimmed = (vehicleModel || "").trim();
  const knownMake = MULTI_WORD_MAKES.find((m) => trimmed.toLowerCase().startsWith(m.toLowerCase()));
  if (knownMake) return { make: knownMake, model: trimmed.slice(knownMake.length).trim() };
  const parts = trimmed.split(/\s+/);
  return { make: parts[0] || "", model: parts.slice(1).join(" ") };
};

const BLANK_CARD = (booking) => {
  const { make, model } = guessMakeModel(booking?.vehicleModel);
  return {
    id: uid("jc"),
    bookingId: booking?.id || null,
    business: booking?.business || BUSINESSES[0],
    createdAt: Date.now(),
    dateIn: booking?.date || todayISO(),
    dateOut: "",
    technician: "",
    make, model, reg: booking?.reg || "",
    mileageIn: "", mileageOut: "",
    customerName: booking?.customerName || "", contact: booking?.phone || "",
    jobStatus: { customerAuthReceived: false },
    authRefNotes: "",
    symptoms: booking?.symptoms || "",
    technicianInterpretation: "",
    preDiagnostic: { preScanCompleted: false },
    diagnosisFindings: "",
    postDiagnostic: { postScanCompleted: false },
    postChecks: { roadTestCompleted: false },
  };
};

// ============================================================
// Root component
// ============================================================
export default function WorkshopHub() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [rawParts, setRawParts] = useState([]);
  const [jobTypes, setJobTypes] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [jobCards, setJobCards] = useState([]);
  const [jobApprovals, setJobApprovals] = useState([]);
  const [priceHistory, setPriceHistory] = useState([]);
  const [stockBatches, setStockBatches] = useState([]);
  const [mode, setMode] = useState("workshop");
  const [saveState, setSaveState] = useState("idle");

  // Every part's stock/cost price is derived from its delivered stock
  // batches (oldest-first), not stored directly — see lib/stockBatches
  // helpers below. Everything downstream (Stock tab, profit calc, Zoho
  // invoicing, job type recipes) just reads part.stock/part.costPrice as
  // before, unaware this is now computed rather than a raw column.
  const parts = useMemo(() => rawParts.map((p) => derivePartFromBatches(p, stockBatches)), [rawParts, stockBatches]);

  useEffect(() => {
    (async () => {
      try {
        const d = await fetchAll();
        setRawParts(d.parts);
        setJobTypes(d.jobTypes);
        setBookings(d.bookings);
        if (d.settings) setSettings({ ...DEFAULT_SETTINGS, ...d.settings });
        setJobCards(d.jobCards);
        setJobApprovals(d.jobApprovals);
        setPriceHistory(d.priceHistory);
        setStockBatches(d.stockBatches);
      } catch (e) {
        console.error("Failed to load Workshop Hub data", e);
      }
      setReady(true);
    })();
  }, []);

  // Realtime — a change made in Office mode on one device shows up in
  // Workshop mode on another, without a manual refresh.
  useEffect(() => {
    if (!ready) return;
    const unsubs = [
      subscribeTable("parts", async () => setRawParts(await fetchParts())),
      subscribeTable("job_types", async () => setJobTypes(await fetchJobTypes())),
      subscribeTable("job_type_parts", async () => setJobTypes(await fetchJobTypes())),
      subscribeTable("bookings", async () => setBookings(await fetchBookings())),
      subscribeTable("booking_job_types", async () => setBookings(await fetchBookings())),
      subscribeTable("booking_extra_parts", async () => setBookings(await fetchBookings())),
      subscribeTable("booking_job_type_prices", async () => setBookings(await fetchBookings())),
      subscribeTable("booking_bom_qty_overrides", async () => setBookings(await fetchBookings())),
      subscribeTable("job_cards", async () => setJobCards(await fetchJobCards())),
      subscribeTable("job_approvals", async () => setJobApprovals(await fetchJobApprovals())),
      subscribeTable("part_price_history", async () => setPriceHistory(await fetchPriceHistory())),
      subscribeTable("stock_batches", async () => setStockBatches(await fetchStockBatches())),
      subscribeTable("settings", async () => { const s = await fetchSettings(); if (s) setSettings({ ...DEFAULT_SETTINGS, ...s }); }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [ready]);

  const withSaveState = useCallback(async (fn) => {
    setSaveState("saving");
    try {
      await fn();
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1000);
    } catch (e) {
      console.error(e);
      setSaveState("idle");
    }
  }, []);

  const partUsageWeekly = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 28);
    const usage = {}; parts.forEach((p) => (usage[p.id] = 0));
    bookings.forEach((b) => {
      const bd = new Date(b.date + "T00:00:00");
      if (bd < cutoff) return;
      const jt = jobTypes.find((j) => j.id === b.jobTypeId);
      if (!jt) return;
      jt.bom.forEach((l) => { usage[l.partId] = (usage[l.partId] || 0) + l.qty; });
    });
    const weekly = {}; Object.keys(usage).forEach((k) => (weekly[k] = usage[k] / 4));
    return weekly;
  }, [bookings, jobTypes, parts]);

  const stockRows = useMemo(() => parts.map((p) => {
    const weekly = partUsageWeekly[p.id] || 0;
    const weeksLeft = weekly > 0 ? p.stock / weekly : Infinity;
    return { ...p, weekly, weeksLeft, needsOrder: weeksLeft < REORDER_WEEKS };
  }), [parts, partUsageWeekly]);
  const lowStockItems = stockRows.filter((r) => r.needsOrder);

  // Pops up whenever a part crosses into "needs reorder" — lives at this
  // level (not inside OfficeMode) so switching to Workshop and back doesn't
  // forget a dismissal by remounting the component. Persisted to
  // localStorage (not just in-memory) so dismissing it actually sticks
  // across page reloads / relaunching the app, not just within one tab
  // session — previously it reset to empty on every load, making "Dismiss"
  // look broken since the alert came straight back next time you opened it.
  const [dismissedReorderIds, setDismissedReorderIds] = useState(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem("wb-dismissed-reorder-ids") || "[]"));
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    localStorage.setItem("wb-dismissed-reorder-ids", JSON.stringify([...dismissedReorderIds]));
  }, [dismissedReorderIds]);
  // Once a dismissed part is restocked (no longer low), forget its dismissal
  // so a future shortage of that same part alerts again instead of staying
  // silenced forever. Gated on `ready` — parts start out as [] before the
  // initial fetch resolves, which looks identical to "nothing low stock"
  // and would otherwise wipe out a just-loaded dismissal before the real
  // data ever arrives.
  useEffect(() => {
    if (!ready) return;
    const lowIds = new Set(lowStockItems.map((r) => r.id));
    setDismissedReorderIds((prev) => {
      const next = new Set([...prev].filter((id) => lowIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [ready, lowStockItems.map((r) => r.id).join(",")]);
  const pendingReorder = lowStockItems.filter((r) => !dismissedReorderIds.has(r.id));
  const [showReorderAlert, setShowReorderAlert] = useState(false);
  useEffect(() => {
    if (pendingReorder.length > 0) setShowReorderAlert(true);
  }, [lowStockItems.map((r) => r.id).join(",")]);

  // Booking a job no longer touches physical stock — parts are only taken
  // out of the FIFO batches once the job is actually marked workshop
  // completed (see updateBooking below), so stock reflects what's actually
  // been used rather than what's merely been booked in.
  const addBooking = (booking) => withSaveState(async () => {
    const jt = jobTypes.find((j) => j.id === booking.jobTypeId);
    const newBooking = { ...booking, id: uid("bk"), createdAt: Date.now() };
    const extraIds = newBooking.extraJobTypeIds || [];
    const extraParts = newBooking.extraParts || [];
    const jobTypePrices = newBooking.jobTypePrices || [];
    const bomQtyOverrides = newBooking.bomQtyOverrides || [];

    setBookings((prev) => [...prev, newBooking]);

    // booking_job_types has a foreign key on bookings, so the insert must
    // land first — firing it in parallel races the FK check and 409s.
    await insertBooking(newBooking);
    await Promise.all([
      ...extraIds.map((jtId) => addBookingJobType(newBooking.id, jtId)),
      ...extraParts.map((l) => setBookingExtraPart(newBooking.id, l.partId, l.qty)),
      ...jobTypePrices.map((l) => setBookingJobTypePrice(newBooking.id, l.jobTypeId, l.price)),
      ...bomQtyOverrides.map((l) => setBookingBomQtyOverride(newBooking.id, l.partId, l.qty)),
    ]);

    const googleEventId = await syncBookingToGoogle({ googleEventId: null, date: newBooking.date, days: newBooking.days, jobTypeName: jt?.name, colorId: jt?.color });
    if (googleEventId) {
      setBookings((prev) => prev.map((b) => (b.id === newBooking.id ? { ...b, googleEventId } : b)));
      await updateBookingRow(newBooking.id, { googleEventId });
    }
  });

  const removeBooking = (id) => withSaveState(async () => {
    const b = bookings.find((x) => x.id === id);
    let batchUpdates = [];
    // Only give stock back if it was actually taken — that only happens once
    // a booking's been marked workshop completed.
    if (b && b.workshopCompleted) {
      const bom = fullBookingBom(b, jobTypes);
      let working = stockBatches;
      for (const l of bom) {
        const updates = returnFIFO(working, l.partId, l.qty);
        batchUpdates.push(...updates);
        working = applyBatchUpdates(working, updates);
      }
      setStockBatches(working);
    }
    setBookings((prev) => prev.filter((x) => x.id !== id));

    await Promise.all([
      deleteBookingRow(id), // cascades booking_job_types + booking_extra_parts rows too
      ...batchUpdates.map((u) => updateStockBatchQtyRemaining(u.batchId, u.qtyRemaining)),
      deleteBookingFromGoogle(b?.googleEventId),
    ]);
  });

  const updateBooking = (id, patch) => withSaveState(async () => {
    const before = bookings.find((b) => b.id === id);
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));

    // bookings-table patch never includes extraJobTypeIds/extraParts/jobTypePrices/
    // bomQtyOverrides — those live in their own junction tables, reconciled separately below.
    const { extraJobTypeIds, extraParts, jobTypePrices, bomQtyOverrides, ...rowPatch } = patch;

    // Stock is only taken out (or given back) at the workshop-completed
    // transition, not at booking time — see addBooking. Three cases:
    //  - first time marked workshop completed: deduct the full recipe now
    //  - un-marking workshop completed: give the full recipe back
    //  - recipe edited on a booking that's already been workshop completed:
    //    stock was already taken, so reconcile just the delta
    let batchUpdates = [];
    if (before) {
      const completingNow = patch.workshopCompleted === true && !before.workshopCompleted;
      const uncompletingNow = patch.workshopCompleted === false && before.workshopCompleted;
      let working = stockBatches;

      if (completingNow) {
        const bom = fullBookingBom({ ...before, ...patch }, jobTypes);
        for (const l of bom) {
          const updates = allocateFIFO(working, l.partId, l.qty);
          batchUpdates.push(...updates);
          working = applyBatchUpdates(working, updates);
        }
        setStockBatches(working);
      } else if (uncompletingNow) {
        const bom = fullBookingBom(before, jobTypes);
        for (const l of bom) {
          const updates = returnFIFO(working, l.partId, l.qty);
          batchUpdates.push(...updates);
          working = applyBatchUpdates(working, updates);
        }
        setStockBatches(working);
      } else if (before.workshopCompleted && ("jobTypeId" in patch || "extraJobTypeIds" in patch || "extraParts" in patch || "bomQtyOverrides" in patch)) {
        const beforeBom = fullBookingBom(before, jobTypes);
        const afterBom = fullBookingBom({ ...before, ...patch }, jobTypes);
        const allPartIds = new Set([...beforeBom.map((l) => l.partId), ...afterBom.map((l) => l.partId)]);
        for (const partId of allPartIds) {
          const oldQty = beforeBom.find((l) => l.partId === partId)?.qty || 0;
          const newQty = afterBom.find((l) => l.partId === partId)?.qty || 0;
          const delta = oldQty - newQty; // positive = return to stock, negative = allocate more
          if (delta === 0) continue;
          const updates = delta > 0 ? returnFIFO(working, partId, delta) : allocateFIFO(working, partId, -delta);
          batchUpdates.push(...updates);
          working = applyBatchUpdates(working, updates);
        }
        setStockBatches(working);
      }
    }

    const jobs = [
      Object.keys(rowPatch).length > 0 ? updateBookingRow(id, rowPatch) : null,
      ...batchUpdates.map((u) => updateStockBatchQtyRemaining(u.batchId, u.qtyRemaining)),
    ];
    if (extraJobTypeIds) {
      const beforeExtras = before?.extraJobTypeIds || [];
      const added = extraJobTypeIds.filter((jtId) => !beforeExtras.includes(jtId));
      const removed = beforeExtras.filter((jtId) => !extraJobTypeIds.includes(jtId));
      jobs.push(...added.map((jtId) => addBookingJobType(id, jtId)), ...removed.map((jtId) => removeBookingJobType(id, jtId)));
    }
    if (extraParts) {
      const beforeParts = before?.extraParts || [];
      const removed = beforeParts.filter((l) => !extraParts.some((n) => n.partId === l.partId));
      jobs.push(...extraParts.map((l) => setBookingExtraPart(id, l.partId, l.qty)), ...removed.map((l) => removeBookingExtraPart(id, l.partId)));
    }
    if (jobTypePrices) {
      const beforePrices = before?.jobTypePrices || [];
      const removed = beforePrices.filter((l) => !jobTypePrices.some((n) => n.jobTypeId === l.jobTypeId));
      jobs.push(...jobTypePrices.map((l) => setBookingJobTypePrice(id, l.jobTypeId, l.price)), ...removed.map((l) => removeBookingJobTypePrice(id, l.jobTypeId)));
    }
    if (bomQtyOverrides) {
      const beforeOverrides = before?.bomQtyOverrides || [];
      const removed = beforeOverrides.filter((l) => !bomQtyOverrides.some((n) => n.partId === l.partId));
      jobs.push(...bomQtyOverrides.map((l) => setBookingBomQtyOverride(id, l.partId, l.qty)), ...removed.map((l) => removeBookingBomQtyOverride(id, l.partId)));
    }
    await Promise.all(jobs.filter(Boolean));

    if ("date" in patch || "jobTypeId" in patch || "days" in patch) {
      const current = { ...before, ...patch };
      const jt = jobTypes.find((j) => j.id === current.jobTypeId);
      const googleEventId = await syncBookingToGoogle({ googleEventId: current.googleEventId, date: current.date, days: current.days, jobTypeName: jt?.name, colorId: jt?.color });
      if (googleEventId && googleEventId !== current.googleEventId) {
        setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, googleEventId } : b)));
        await updateBookingRow(id, { googleEventId });
      }
    }
  });

  // Plain quantity correction (stocktake found more/less, wastage) — no
  // price involved, unlike ordering. Adding creates one new delivered batch
  // at the part's current derived cost price; removing deducts FIFO from
  // existing batches, same as a booking using the part up.
  const receiveStock = (partId, qty) => withSaveState(async () => {
    if (qty > 0) {
      const part = parts.find((p) => p.id === partId);
      const now = new Date().toISOString();
      const newBatch = { id: uid("sb"), partId, qtyOrdered: qty, qtyRemaining: qty, price: part?.costPrice || 0, supplier: "", status: "delivered", orderedAt: now, deliveredAt: now };
      setStockBatches((prev) => [...prev, newBatch]);
      await insertStockBatch(newBatch);
    } else if (qty < 0) {
      const updates = allocateFIFO(stockBatches, partId, -qty);
      setStockBatches((prev) => applyBatchUpdates(prev, updates));
      await Promise.all(updates.map((u) => updateStockBatchQtyRemaining(u.batchId, u.qtyRemaining)));
    }
  });

  // Places an order at a price — doesn't count as physical stock yet.
  const orderStock = (partId, qty, price, dueDate, supplier) => withSaveState(async () => {
    const newBatch = { id: uid("sb"), partId, qtyOrdered: qty, qtyRemaining: qty, price, supplier: supplier || "", status: "ordered", orderedAt: new Date().toISOString(), deliveredAt: null, dueDate: dueDate || null };
    setStockBatches((prev) => [...prev, newBatch]);
    await insertStockBatch(newBatch);
  });

  // Marks an order as physically arrived — from this point it counts toward
  // physical stock and joins the FIFO cost queue. Also logs it to price
  // history so the existing reorder-alert "12-month low" feature stays fed
  // without a separate manual entry.
  const deliverStock = (batchId) => withSaveState(async () => {
    const batch = stockBatches.find((b) => b.id === batchId);
    if (!batch) return;
    const deliveredAt = new Date().toISOString();
    setStockBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, status: "delivered", deliveredAt } : b)));
    const historyEntry = { id: uid("ph"), partId: batch.partId, price: batch.price, qty: batch.qtyOrdered, supplier: batch.supplier || null, recordedAt: deliveredAt };
    setPriceHistory((prev) => [...prev, historyEntry]);
    await Promise.all([markStockBatchDelivered(batchId, deliveredAt), insertPriceHistory(historyEntry)]);
  });

  const updatePartField = (partId, patch) => withSaveState(async () => {
    setRawParts((prev) => prev.map((p) => (p.id === partId ? { ...p, ...patch } : p)));
    await updatePart(partId, patch);
  });

  // Manually logging a price seen elsewhere (for the reorder alert's
  // "12-month low" trend) — no longer changes the part's actual cost price,
  // since that's derived from delivered stock batches now. Purely a log.
  const recordPrice = (partId, price, qty, supplier) => withSaveState(async () => {
    const entry = { id: uid("ph"), partId, price, qty: qty || null, supplier: supplier || null, recordedAt: new Date().toISOString() };
    setPriceHistory((prev) => [...prev, entry]);
    await insertPriceHistory(entry);
  });

  const addPart = (name, unit) => withSaveState(async () => {
    const part = { id: uid("p"), name, unit, stock: 0, costPrice: 0 };
    setRawParts((prev) => [...prev, part]);
    await insertPart(part);
  });

  const removePart = (partId) => withSaveState(async () => {
    setRawParts((prev) => prev.filter((p) => p.id !== partId));
    setStockBatches((prev) => prev.filter((b) => b.partId !== partId)); // DB cascades this delete too
    setJobTypes((prev) => prev.map((jt) => ({ ...jt, bom: jt.bom.filter((l) => l.partId !== partId) })));
    await deletePart(partId);
  });

  const addJobTypeFn = (name) => withSaveState(async () => {
    const jobType = { id: uid("jt"), name, bom: [] };
    setJobTypes((prev) => [...prev, jobType]);
    await insertJobType(jobType);
  });

  const renameJobTypeFn = (jtId, name) => withSaveState(async () => {
    setJobTypes((prev) => prev.map((j) => (j.id === jtId ? { ...j, name } : j)));
    await renameJobType(jtId, name);
  });

  const updateJobTypeColorFn = (jtId, color) => withSaveState(async () => {
    setJobTypes((prev) => prev.map((j) => (j.id === jtId ? { ...j, color } : j)));
    await updateJobTypeColor(jtId, color);
  });

  const addBomLineFn = (jtId, partId) => withSaveState(async () => {
    setJobTypes((prev) => prev.map((jt) => {
      if (jt.id !== jtId || jt.bom.some((l) => l.partId === partId)) return jt;
      return { ...jt, bom: [...jt.bom, { partId, qty: 1 }] };
    }));
    await addBomLine(jtId, partId, 1);
  });

  const updateBomQtyFn = (jtId, partId, qty) => withSaveState(async () => {
    setJobTypes((prev) => prev.map((jt) => (jt.id !== jtId ? jt : { ...jt, bom: jt.bom.map((l) => (l.partId === partId ? { ...l, qty } : l)) })));
    await updateBomLine(jtId, partId, qty);
  });

  const removeBomLineFn = (jtId, partId) => withSaveState(async () => {
    setJobTypes((prev) => prev.map((jt) => (jt.id !== jtId ? jt : { ...jt, bom: jt.bom.filter((l) => l.partId !== partId) })));
    await removeBomLine(jtId, partId);
  });

  const updateSettingsField = (patch) => withSaveState(async () => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
  });

  const upsertJobCard = (card) => withSaveState(async () => {
    setJobCards((prev) => {
      const exists = prev.some((c) => c.id === card.id);
      return exists ? prev.map((c) => (c.id === card.id ? card : c)) : [card, ...prev];
    });
    await upsertJobCardRow(card);
  });

  const updateJobCard = (id, patch) => withSaveState(async () => {
    setJobCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    await updateJobCardRow(id, patch);
  });

  // For customers who cancel after a job card's already been started —
  // deletes the technician's work record only. The underlying booking (if
  // any) is untouched; office can cancel/delete that separately.
  const removeJobCard = (id) => withSaveState(async () => {
    setJobCards((prev) => prev.filter((c) => c.id !== id));
    await deleteJobCardRow(id);
  });

  // Technician flags extra work found during diagnosis — raw notes only,
  // no price, nothing sent to the customer yet. Office reviews it (see the
  // pending-approvals banner), sets a price, and sends it on.
  const addJobApproval = (jobCardId, bookingId, description) => withSaveState(async () => {
    const approval = { id: uid("ja"), jobCardId, bookingId, description, status: "draft" };
    setJobApprovals((prev) => [approval, ...prev]);
    await insertJobApproval(approval);
  });

  const updateJobApproval = (id, patch) => withSaveState(async () => {
    setJobApprovals((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    await updateJobApprovalRow(id, patch);
  });

  const removeJobApproval = (id) => withSaveState(async () => {
    setJobApprovals((prev) => prev.filter((a) => a.id !== id));
    await deleteJobApproval(id);
  });

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  if (!ready) {
    return <div style={{ background: "#16181a", color: "#d8d4cc", minHeight: 480, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "ui-monospace, monospace" }}>loading…</div>;
  }

  return (
    <div style={{ "--bg": "#16181a", "--panel": "#1e2124", "--panel2": "#25292c", "--line": "#33383c", "--text": "#e7e3da", "--muted": "#9aa0a6", "--amber": "#f5a623", "--amber2": "#ffcf6b", "--red": "#e2574c", "--green": "#5fb87a" }} className="wh-root">
      <style>{`
        .wh-root { background: var(--bg); color: var(--text); font-family: var(--font-inter), 'Inter', ui-sans-serif, system-ui, sans-serif; min-height: 100vh; -webkit-tap-highlight-color: transparent; }
        .wh-mono { font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
        .wh-topbar { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid var(--line); position:sticky; top:0; background:#16181a; z-index:20; }
        .wh-title { font-weight:800; font-size:17px; display:flex; align-items:center; gap:8px; }
        .wh-modeswitch { display:flex; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
        .wh-modebtn { padding:10px 16px; font-size:13px; font-weight:700; background:var(--panel); color:var(--muted); cursor:pointer; display:flex; align-items:center; gap:6px; border:none; }
        .wh-modebtn.active { background: var(--amber); color:#1a1508; }
        .wb-tabs { display:flex; gap:4px; padding:10px 18px 0; border-bottom:1px solid var(--line); overflow-x:auto; }
        .wb-tab { padding:10px 14px; font-size:13px; font-weight:600; color:var(--muted); border-bottom:2px solid transparent; cursor:pointer; display:flex; align-items:center; gap:6px; white-space:nowrap; }
        .wb-tab.active { color:var(--amber2); border-bottom-color: var(--amber); }
        .wb-cal-layout { display:grid; grid-template-columns: 1fr 340px; gap:18px; }
        .wb-daypanel-close { display:none; }
@media (max-width: 800px) {
  .wb-cal-layout { grid-template-columns: 1fr; }
  .wb-body { padding:12px; }
  .wb-day { min-height:56px; padding:4px; }
  .wb-daypanel { position:fixed; top:0; left:0; bottom:0; width:100%; z-index:45; border-radius:0; overflow-y:auto; transform:translateX(-100%); transition:transform 0.2s ease; visibility:hidden; }
  .wb-daypanel.open { transform:translateX(0); visibility:visible; }
  .wb-daypanel-close { display:flex; background:none; border:1px solid var(--line); border-radius:8px; color:var(--text); cursor:pointer; padding:8px; align-items:center; justify-content:center; }
}
        .wb-panel, .jc-card { background: var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; }
        .wb-btn, .jc-btn { background: var(--amber); color:#1a1508; font-weight:700; border:none; border-radius:8px; padding:12px 16px; font-size:14px; display:inline-flex; align-items:center; gap:7px; cursor:pointer; min-height:44px; }
        .wb-btn:hover { background: var(--amber2); }
        .wb-btn-ghost, .jc-btn-ghost { background:transparent; border:1px solid var(--line); color:var(--text); border-radius:8px; padding:12px 16px; font-size:14px; display:inline-flex; align-items:center; gap:7px; cursor:pointer; min-height:44px; }
        .jc-btn-sm { background: var(--panel2); border:1px solid var(--line); color:var(--text); border-radius:8px; padding:8px 12px; font-size:13px; display:inline-flex; align-items:center; gap:6px; cursor:pointer; min-height:36px; }
        .wb-input, .wb-select, .wb-textarea, .jc-input, .jc-textarea, .jc-select { width:100%; background: var(--panel2); border:1px solid var(--line); color:var(--text); border-radius:8px; padding:12px 12px; font-size:16px; font-family:inherit; }
        .wb-input:focus, .wb-select:focus, .wb-textarea:focus, .jc-input:focus, .jc-textarea:focus { outline:none; border-color: var(--amber); }
        .wb-label, .jc-label { font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:5px; display:block; font-weight:600; }
        .wb-day { min-height:78px; border:1px solid var(--line); padding:6px; cursor:pointer; }
        .wb-day:hover { background: var(--panel2); }
        .wb-day.selected { border-color: var(--amber); box-shadow: inset 0 0 0 1px var(--amber); }
        .wb-day.today .wb-daynum { color: var(--amber2); }
        .wb-daynum { font-size:11px; color:var(--muted); font-weight:600; }
        .wb-chip, .jc-chip { font-size:10px; background:#2b2410; color:var(--amber2); border-radius:3px; padding:1px 5px; margin-top:3px; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .wb-badge-low { background:#3a1210; color:var(--red); border:1px solid #5a2320; font-size:10px; padding:2px 7px; border-radius:20px; font-weight:700; }
        .wb-badge-ok { background:#10281a; color:var(--green); border:1px solid #1f4530; font-size:10px; padding:2px 7px; border-radius:20px; font-weight:700; }
        .wb-modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:flex-start; justify-content:center; padding:30px 14px; z-index:50; overflow-y:auto; }
        .wb-modal { background: var(--panel); border:1px solid var(--line); border-radius:10px; width:100%; max-width:640px; }
        table.wb-table { width:100%; border-collapse:collapse; font-size:13px; }
        table.wb-table th { text-align:left; color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:0.08em; padding:8px 10px; border-bottom:1px solid var(--line); }
        table.wb-table td { padding:9px 10px; border-bottom:1px solid #2a2d30; }
        table.wb-table tbody tr:hover { background: var(--panel2); }
        .jc-section-title { font-size:14px; font-weight:800; color:var(--amber2); display:flex; align-items:center; gap:8px; margin-bottom:12px; text-transform:uppercase; letter-spacing:0.04em; }
        .jc-toggle { display:flex; align-items:center; gap:10px; padding:13px 14px; border-radius:8px; border:1px solid var(--line); background: var(--panel2); cursor:pointer; font-size:14px; min-height:48px; }
        .jc-toggle.on { background:#1c2f22; border-color: var(--green); color: var(--green); font-weight:700; }
        .jc-list-item { background: var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; cursor:pointer; }
        .jc-list-item:active { border-color: var(--amber); }
        .jc-chip.locked { background:#241512; color:var(--red); }
        .jc-chip.w4 { background:#241d10; color:var(--amber2); }
        .req-banner { background:#241512; border:1px solid #4a2420; color: var(--red); border-radius:8px; padding:10px 12px; font-size:12px; display:flex; align-items:center; gap:8px; }
        .req-banner.ok { background:#10281a; border-color:#1f4530; color: var(--green); }
        .print-job-card { display: none; }
        @media print {
          body * { visibility: hidden; }
          .print-job-card, .print-job-card * { visibility: visible; }
          .print-job-card { display: block; position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>

      <div className="wh-topbar">
        <div className="wh-title"><Wrench size={20} color="var(--amber)" /> Workshop Hub</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 11, color: "var(--muted)" }} className="wh-mono">{saveState === "saving" ? "saving…" : saveState === "saved" ? "saved ✓" : " "}</div>
          <div className="wh-modeswitch">
            <button className={`wh-modebtn ${mode === "office" ? "active" : ""}`} onClick={() => setMode("office")}><Building2 size={14} /> Office</button>
            <button className={`wh-modebtn ${mode === "workshop" ? "active" : ""}`} onClick={() => setMode("workshop")}><LayoutGrid size={14} /> Workshop</button>
          </div>
          <button className="wb-btn-ghost" style={{ padding: "8px 10px", minHeight: "auto" }} onClick={logout} title="Log out"><LogOut size={14} /></button>
        </div>
      </div>

      {mode === "office" ? (
        <OfficeMode
          parts={parts} jobTypes={jobTypes}
          addPart={addPart} removePart={removePart} updatePartField={updatePartField}
          addJobType={addJobTypeFn} renameJobType={renameJobTypeFn} updateJobTypeColor={updateJobTypeColorFn}
          addBomLine={addBomLineFn} updateBomQty={updateBomQtyFn} removeBomLine={removeBomLineFn}
          bookings={bookings} addBooking={addBooking} removeBooking={removeBooking} updateBooking={updateBooking}
          settings={settings} updateSettingsField={updateSettingsField}
          stockRows={stockRows} lowStockItems={lowStockItems} receiveStock={receiveStock}
          stockBatches={stockBatches} orderStock={orderStock} deliverStock={deliverStock}
          priceHistory={priceHistory} recordPrice={recordPrice}
          pendingReorder={pendingReorder} showReorderAlert={showReorderAlert}
          setShowReorderAlert={setShowReorderAlert} setDismissedReorderIds={setDismissedReorderIds}
          jobCards={jobCards} jobApprovals={jobApprovals} updateJobApproval={updateJobApproval} removeJobApproval={removeJobApproval}
        />
      ) : (
        <WorkshopMode
          bookings={bookings} jobTypes={jobTypes} parts={parts} settings={settings}
          jobCards={jobCards} upsertJobCard={upsertJobCard} updateJobCard={updateJobCard} removeJobCard={removeJobCard} updateBooking={updateBooking}
          jobApprovals={jobApprovals} addJobApproval={addJobApproval} removeJobApproval={removeJobApproval}
        />
      )}
    </div>
  );
}

// ============================================================
// OFFICE MODE (reception / desktop)
// ============================================================
function OfficeMode({
  parts, jobTypes, addPart, removePart, updatePartField, addJobType, renameJobType, updateJobTypeColor, addBomLine, updateBomQty, removeBomLine,
  bookings, addBooking, removeBooking, updateBooking, settings, updateSettingsField, stockRows, lowStockItems, receiveStock,
  stockBatches, orderStock, deliverStock,
  priceHistory, recordPrice, pendingReorder, showReorderAlert, setShowReorderAlert, setDismissedReorderIds,
  jobCards, jobApprovals, updateJobApproval, removeJobApproval,
}) {
  const [tab, setTab] = useState("calendar");
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState(todayISO());
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [editingBooking, setEditingBooking] = useState(null);
  const [printJob, setPrintJob] = useState(null);

  // Fires the OS print dialog the moment a new booking is saved — each job
  // card then lands in a physical pile at reception for the next available
  // tech to pick up, one card per booking taken.
  useEffect(() => {
    if (!printJob) return;
    const t = setTimeout(() => window.print(), 50);
    const clear = () => setPrintJob(null);
    window.addEventListener("afterprint", clear);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", clear); };
  }, [printJob]);

  return (
    <div>
      <div className="wb-tabs">
        {[["calendar", "Calendar", Calendar], ["jobs", "Jobs", List], ["stock", "Stock & Reorder", Package], ["jobtypes", "Job Types", ListChecks], ["profitability", "Profitability", PoundSterling], ["settings", "Settings", SettingsIcon]].map(([key, label, Icon]) => (
          <div key={key} className={`wb-tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>
            <Icon size={14} /> {label}
            {key === "stock" && lowStockItems.length > 0 && <span className="wb-badge-low" style={{ marginLeft: 4 }}>{lowStockItems.length}</span>}
          </div>
        ))}
      </div>
      <div className="wb-body">
        {tab === "calendar" && (
          <CalendarTab monthCursor={monthCursor} setMonthCursor={setMonthCursor} bookings={bookings} selectedDay={selectedDay} setSelectedDay={setSelectedDay}
            onNewBooking={() => setShowNewBooking(true)} onEditBooking={(b) => setEditingBooking(b)} onPrintJob={setPrintJob}
            jobTypes={jobTypes} parts={parts} settings={settings} removeBooking={removeBooking} updateBooking={updateBooking}
            jobCards={jobCards} jobApprovals={jobApprovals} updateJobApproval={updateJobApproval} removeJobApproval={removeJobApproval} />
        )}
        {tab === "jobs" && (
          <JobsTableTab
            bookings={bookings} jobTypes={jobTypes}
            onOpenBooking={(b) => {
              setMonthCursor(new Date(new Date(b.date).getFullYear(), new Date(b.date).getMonth(), 1));
              setSelectedDay(b.date);
              setTab("calendar");
            }}
          />
        )}
        {tab === "stock" && (
          <StockTab stockRows={stockRows} jobTypes={jobTypes} receiveStock={receiveStock} updatePartField={updatePartField} removePart={removePart}
            stockBatches={stockBatches} orderStock={orderStock} deliverStock={deliverStock}
            priceHistory={priceHistory} recordPrice={recordPrice} />
        )}
        {tab === "jobtypes" && (
          <JobTypesTab jobTypes={jobTypes} parts={parts} addPart={addPart} addJobType={addJobType} renameJobType={renameJobType}
            updateJobTypeColor={updateJobTypeColor} addBomLine={addBomLine} updateBomQty={updateBomQty} removeBomLine={removeBomLine} />
        )}
        {tab === "profitability" && (
          <ProfitabilityGate>
            <ProfitabilityTab bookings={bookings} jobTypes={jobTypes} parts={parts} settings={settings} />
          </ProfitabilityGate>
        )}
        {tab === "settings" && <SettingsTab settings={settings} updateSettingsField={updateSettingsField} />}
      </div>
      {(showNewBooking || editingBooking) && (
        <NewBookingModal
          jobTypes={jobTypes} parts={parts} settings={settings} defaultDate={selectedDay} booking={editingBooking}
          onClose={() => { setShowNewBooking(false); setEditingBooking(null); }}
          onSave={(b) => {
            if (editingBooking) {
              updateBooking(editingBooking.id, b);
            } else {
              addBooking(b);
              setPrintJob(b);
            }
            setShowNewBooking(false); setEditingBooking(null); setSelectedDay(b.date);
          }}
        />
      )}
      {printJob && <JobCardPrintout booking={printJob} jobTypes={jobTypes} />}
      {showReorderAlert && pendingReorder.length > 0 && (
        <ReorderAlertModal
          items={pendingReorder}
          priceHistory={priceHistory}
          onClose={() => setShowReorderAlert(false)}
          onDismiss={() => {
            setDismissedReorderIds((prev) => new Set([...prev, ...pendingReorder.map((r) => r.id)]));
            setShowReorderAlert(false);
          }}
        />
      )}
    </div>
  );
}

// Printed the moment a new booking is saved (see OfficeMode's onSave) so it
// can go straight into a physical pile at reception — techs work through the
// pile one job card at a time. Plain black-on-white regardless of the app's
// dark theme, since it's meant for a printer, not a screen.
function JobCardPrintout({ booking, jobTypes }) {
  const jt = jobTypes.find((j) => j.id === booking.jobTypeId);
  const extraJts = (booking.extraJobTypeIds || []).map((id) => jobTypes.find((j) => j.id === id)).filter(Boolean);
  const jobTypeLabel = [jt?.name, ...extraJts.map((e) => e.name)].filter(Boolean).join(" + ");
  const rows = [
    ["Business", booking.business],
    ["Booking date", booking.date ? fmtDate(booking.date) : ""],
    ["Customer name", booking.customerName],
    ["Address", booking.pickupAddress],
    ["Phone", booking.phone],
    ["Vehicle registration", booking.reg],
    ["Vehicle model", booking.vehicleModel],
    ["Booked in for", jobTypeLabel],
  ].filter(([, value]) => value);

  return (
    <div className="print-job-card">
      <div style={{ padding: 32, color: "#000", background: "#fff", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 2 }}>{booking.business}</div>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.08em", color: "#555", marginBottom: 20 }}>JOB CARD</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 20 }}>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <td style={{ padding: "6px 12px 6px 0", fontWeight: 700, verticalAlign: "top", whiteSpace: "nowrap" }}>{label}</td>
                <td style={{ padding: "6px 0", borderBottom: "1px solid #ccc" }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Customer notes</div>
        <div style={{ border: "1px solid #000", borderRadius: 4, padding: 10, minHeight: 90, fontSize: 13, whiteSpace: "pre-wrap", marginBottom: 20 }}>
          {booking.symptoms || "—"}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Comments</div>
        <div style={{ border: "1px solid #000", borderRadius: 4, minHeight: 220 }} />
      </div>
    </div>
  );
}

// Pops up when parts drop below reorder cover. Shows what's needed plus the
// 12-month low from that part's price history, and offers to copy a ready
// -made summary to paste to Claude in chat for a live price comparison —
// there's no search API wired into the app itself, so this is the bridge.
function ReorderAlertModal({ items, priceHistory, onClose, onDismiss }) {
  const [copiedId, setCopiedId] = useState(null);
  const yearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;

  const rows = items.map((item) => {
    const history = priceHistory.filter((h) => h.partId === item.id).sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));
    const last = history[history.length - 1] || null;
    const recent = history.filter((h) => new Date(h.recordedAt).getTime() >= yearAgo);
    const lowest12mo = recent.length ? Math.min(...recent.map((h) => h.price)) : null;
    return {
      item,
      lastOrderQty: last?.qty ?? null,
      lastPrice: last?.price ?? item.costPrice,
      lowest12mo,
    };
  });

  const copyDetails = async (r) => {
    const text = `Check current prices for: ${r.item.name}${r.item.partNumber ? ` (part number ${r.item.partNumber})` : ""}, last ordered ${r.lastOrderQty ?? "?"} @ £${r.lastPrice.toFixed(2)}${r.lowest12mo !== null ? `, 12-month low £${r.lowest12mo.toFixed(2)}` : ""}.`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(r.item.id);
      setTimeout(() => setCopiedId((prev) => (prev === r.item.id ? null : prev)), 2000);
    } catch {
      // Clipboard access can be blocked (unfocused tab, permissions, older browsers)
      // — fall back to a manual copy so the feature still works.
      prompt("Copy this and paste it to Claude in chat:", text);
    }
  };

  return (
    <div className="wb-modal-backdrop" onClick={onClose}>
      <div className="wb-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8, color: "var(--red)" }}>
            <AlertTriangle size={16} /> Parts order needed
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="wb-table">
              <thead><tr><th>Product</th><th>Part no.</th><th>Last order qty</th><th>Last price</th><th>12-mo low</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.item.id}>
                    <td style={{ fontWeight: 600 }}>{r.item.name}</td>
                    <td>{r.item.partNumber || "—"}</td>
                    <td className="wh-mono">{r.lastOrderQty ?? "—"}</td>
                    <td className="wh-mono">£{r.lastPrice.toFixed(2)}</td>
                    <td className="wh-mono">{r.lowest12mo !== null ? `£${r.lowest12mo.toFixed(2)}` : "—"}</td>
                    <td>
                      <button className="wb-btn-ghost" style={{ padding: "6px 10px", minHeight: 32, whiteSpace: "nowrap" }} onClick={() => copyDetails(r)}>
                        {copiedId === r.item.id ? "Copied ✓" : "Search for a better price?"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            "Search for a better price?" copies the part's details — paste them to Claude in chat to get a live comparison across suppliers.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="wb-btn-ghost" onClick={onClose}>Not now</button>
            <button className="wb-btn" onClick={onDismiss}>Dismiss</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Big, tap-friendly status buttons tracking a booking through the
// workshop: red IN once the vehicle's arrived, orange DONE once the
// workshop's finished the job, green COMP once the customer's collected
// it. Filled when on, outlined when not — click to toggle either way.
function TrafficLightButton({ on, color, textOn, label, title, onClick }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        minWidth: 56, minHeight: 40, padding: "8px 10px", borderRadius: 8,
        fontSize: 13, fontWeight: 800, letterSpacing: "0.03em", cursor: "pointer",
        border: `2px solid ${color}`, background: on ? color : "transparent", color: on ? textOn : color,
      }}
    >
      {label}
    </button>
  );
}

function TrafficLightButtons({ booking, updateBooking, showCollected = true, onMarkArrived }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <TrafficLightButton
        on={booking.arrived} color="var(--red)" textOn="#fff" label="IN"
        title={booking.arrived ? "Mark as not yet arrived" : "Mark vehicle arrived"}
        onClick={() => {
          // Turning it on goes through the intake confirmation pop-up when
          // one's supplied (Office side only) — undo stays a plain toggle.
          if (!booking.arrived && onMarkArrived) { onMarkArrived(booking); return; }
          updateBooking(booking.id, booking.arrived ? { arrived: false, arrivedAt: null } : { arrived: true, arrivedAt: Date.now() });
        }}
      />
      <TrafficLightButton
        on={booking.workshopCompleted} color="#ffb84d" textOn="#1a1508" label="DONE"
        title={booking.workshopCompleted ? "Mark as not yet workshop completed" : "Mark workshop completed — ready for collection, can be invoiced"}
        onClick={() => {
          const turningOn = !booking.workshopCompleted;
          updateBooking(booking.id, turningOn ? { workshopCompleted: true, workshopCompletedAt: Date.now() } : { workshopCompleted: false, workshopCompletedAt: null });
          if (turningOn && booking.phone) window.open(whatsappLink(booking.phone, workshopCompletedMessage(booking)), "_blank");
        }}
      />
      {showCollected && (
        <TrafficLightButton
          on={booking.completed} color="var(--green)" textOn="#fff" label="COMP"
          title={booking.completed ? "Mark as not yet collected" : "Mark collected — counts in Profitability"}
          onClick={() => {
            const turningOn = !booking.completed;
            updateBooking(booking.id, turningOn
              ? { completed: true, completedAt: Date.now(), followupSent: false }
              : { completed: false, completedAt: null });
            if (turningOn && booking.phone) window.open(whatsappLink(booking.phone, collectionThankYouMessage(booking)), "_blank");
          }}
        />
      )}
    </div>
  );
}

// The colour/label for whichever traffic-light stage a booking has
// currently reached — shared by the calendar chip, the day-panel name,
// and the Jobs table, so they can never fall out of sync with each other.
function bookingStatus(b) {
  if (b.completed) return { color: "var(--green)", label: "Collected" };
  if (b.workshopCompleted) return { color: "#ffb84d", label: "Workshop completed" };
  if (b.arrived) return { color: "var(--red)", label: "Arrived" };
  return { color: null, label: "Not started" };
}

// The legal/evidence record captured with the customer present at
// drop-off — separate from the workshop's own internal job card, which
// stays purely diagnostic. Office fills this in the moment the "IN"
// button is pressed, before any work starts.
function IntakeConfirmationModal({ booking, jobTypes, onClose, onConfirmed }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [preScanCompleted, setPreScanCompleted] = useState(false);
  const [videoFile, setVideoFile] = useState(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [name, setName] = useState(booking.customerName || "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const jt = jobTypes.find((j) => j.id === booking.jobTypeId);
  const extraJts = (booking.extraJobTypeIds || []).map((id) => jobTypes.find((j) => j.id === id)).filter(Boolean);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio; canvas.height = 160 * ratio; ctx.scale(ratio, ratio);
    ctx.strokeStyle = "#e7e3da"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  }, []);

  const getPos = (e) => { const canvas = canvasRef.current; const rect = canvas.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: p.clientX - rect.left, y: p.clientY - rect.top }; };
  const start = (e) => { e.preventDefault(); drawingRef.current = true; const ctx = canvasRef.current.getContext("2d"); const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => { if (!drawingRef.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setHasDrawn(true); };
  const end = () => { drawingRef.current = false; };
  const clearSig = () => { const canvas = canvasRef.current; canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); setHasDrawn(false); };

  // Uploads straight from the browser to the Drive session URL our server
  // handed back — the video's bytes never pass through our own API route.
  const uploadVideo = async () => {
    setStatus("Uploading video…");
    const sessionRes = await fetch("/api/office/intake-video-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: `${booking.reg || booking.customerName || "vehicle"} - drop-off video.${(videoFile.name.split(".").pop() || "mp4")}`, mimeType: videoFile.type || "video/mp4" }),
    });
    const sessionData = await sessionRes.json();
    if (!sessionRes.ok) throw new Error(sessionData.error || "Failed to start video upload");

    const putRes = await fetch(sessionData.uploadUrl, { method: "PUT", headers: { "Content-Type": videoFile.type || "video/mp4" }, body: videoFile });
    const putData = await putRes.json();
    if (!putRes.ok || !putData.id) throw new Error("Video upload failed");
    return putData.id;
  };

  const confirm = async () => {
    if (!hasDrawn) { alert("Please have the customer sign before confirming."); return; }
    if (!name.trim()) { alert("Please add the customer's printed name."); return; }
    setSaving(true);
    setStatus("");
    try {
      const videoFileId = videoFile ? await uploadVideo() : null;
      setStatus("Saving confirmation…");
      const signatureDataUrl = canvasRef.current.toDataURL("image/png");
      const res = await fetch("/api/office/intake-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: booking.id, preScanCompleted, signatureName: name.trim(), signatureDataUrl, videoFileId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save the intake confirmation");
      onConfirmed();
    } catch (e) {
      alert(e.message || "Failed to save the intake confirmation — check your connection and try again.");
    }
    setSaving(false);
    setStatus("");
  };

  return (
    <div className="wb-modal-backdrop">
      <div className="wb-modal" style={{ maxWidth: 520 }}>
        <div style={{ padding: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Vehicle drop-off confirmation</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Complete this with the customer present, before any work starts.</div>

          <div className="jc-card" style={{ marginBottom: 12 }}>
            <div className="jc-section-title"><User size={14} /> Customer details</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <div><strong>{booking.customerName || "Unnamed"}</strong></div>
              {booking.phone && <div>{booking.phone}</div>}
              {booking.email && <div>{booking.email}</div>}
              {booking.reg && <div className="wh-mono">{booking.reg}</div>}
              {booking.vehicleModel && <div>{booking.vehicleModel}</div>}
            </div>
          </div>

          <div className="jc-card" style={{ marginBottom: 12 }}>
            <div className="jc-section-title">Symptoms</div>
            <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{booking.symptoms || "—"}</div>
          </div>

          <div className="jc-card" style={{ marginBottom: 12 }}>
            <div className="jc-section-title">Confirmation of work needed</div>
            <div style={{ fontSize: 13 }}>
              {jt?.name || "—"}{extraJts.length > 0 && ` + ${extraJts.map((e) => e.name).join(" + ")}`}
            </div>
            {booking.jobValue ? <div style={{ fontSize: 13, color: "var(--amber2)", marginTop: 4 }} className="wh-mono">£{Number(booking.jobValue).toFixed(2)}</div> : null}
          </div>

          <div className="jc-card" style={{ marginBottom: 12 }}>
            <Toggle label="Pre scan completed" on={preScanCompleted} onClick={() => setPreScanCompleted((v) => !v)} />
            <div style={{ marginTop: 12 }}>
              <label className="jc-label">Drop-off video (optional)</label>
              <input type="file" accept="video/*" className="jc-input" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
              {videoFile && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{videoFile.name}</div>}
            </div>
          </div>

          <div className="jc-card">
            <div className="jc-section-title"><PenLine size={14} /> Customer signature</div>
            <div style={{ marginBottom: 10 }}><label className="jc-label">Customer printed name</label><input className="jc-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <canvas ref={canvasRef} style={{ width: "100%", height: 160, background: "var(--panel2)", border: "1px dashed var(--line)", borderRadius: 10, touchAction: "none" }}
              onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
            <button className="wb-btn-ghost" style={{ marginTop: 10 }} onClick={clearSig}><RotateCcw size={14} /> Clear</button>
          </div>
        </div>
        <div style={{ padding: 16, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
          {status && <span style={{ fontSize: 12, color: "var(--muted)", marginRight: "auto" }}>{status}</span>}
          <button className="wb-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="wb-btn" disabled={saving} onClick={confirm}>{saving ? "Saving…" : "Confirm arrival"}</button>
        </div>
      </div>
    </div>
  );
}

function CalendarTab({ monthCursor, setMonthCursor, bookings, selectedDay, setSelectedDay, onNewBooking, onEditBooking, onPrintJob, jobTypes, parts, settings, removeBooking, updateBooking, jobCards, jobApprovals, updateJobApproval, removeJobApproval }) {
  const partsIndex = useMemo(() => Object.fromEntries(parts.map((p) => [p.id, p.name])), [parts]);
  const year = monthCursor.getFullYear(), month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = []; for (let i = 0; i < startOffset; i++) cells.push(null); for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const bookingsByDay = useMemo(() => {
    const map = {};
    bookings.forEach((b) => bookingDates(b).forEach((iso) => { map[iso] = map[iso] || []; map[iso].push(b); }));
    return map;
  }, [bookings]);
  const dayBookings = bookingsByDay[selectedDay] || [];
  // On mobile the day panel normally sits below the whole month grid, so
  // tapping a tiny customer chip meant scrolling right past it to do
  // anything — this makes it open as a full-screen overlay instead.
  const [mobileDayOpen, setMobileDayOpen] = useState(false);
  const [intakeBooking, setIntakeBooking] = useState(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <PendingApprovalBanner jobApprovals={jobApprovals} jobCards={jobCards} bookings={bookings} jobTypes={jobTypes} updateJobApproval={updateJobApproval} removeJobApproval={removeJobApproval} />
      <TwoDayReminderBanner bookings={bookings} updateBooking={updateBooking} />
      <FollowUpBanner bookings={bookings} updateBooking={updateBooking} />
      <ReviewFollowUpBanner bookings={bookings} updateBooking={updateBooking} />
      <div className="wb-cal-layout">
      <div className="wb-panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="wb-btn-ghost" onClick={() => setMonthCursor(new Date(year, month - 1, 1))}><ChevronLeft size={14} /></button>
            <div style={{ fontWeight: 700, fontSize: 15, minWidth: 150, textAlign: "center" }}>{monthCursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
            <button className="wb-btn-ghost" onClick={() => setMonthCursor(new Date(year, month + 1, 1))}><ChevronRight size={14} /></button>
          </div>
          <button className="wb-btn" onClick={onNewBooking}><Plus size={14} /> New booking</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", padding: "4px 0" }}>{d}</div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="wb-day" style={{ visibility: "hidden" }} />;
            const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const dayBk = bookingsByDay[iso] || [];
            const isToday = iso === todayISO();
            return (
              <div key={i} className={`wb-day ${iso === selectedDay ? "selected" : ""} ${isToday ? "today" : ""}`} onClick={() => { setSelectedDay(iso); if (dayBk.length > 0) setMobileDayOpen(true); }}>
                <div className="wb-daynum">{d}</div>
                {dayBk.slice(0, 5).map((b) => {
                  const st = bookingStatus(b);
                  return (
                    <span
                      key={b.id}
                      className={`wb-chip ${b.business === "Timing Chain Specialists" ? "tcs" : ""}`}
                      style={st.color ? { color: st.color, background: "transparent", border: `1px solid ${st.color}` } : undefined}
                      title={st.label}
                    >
                      {b.customerName || "Booking"}
                    </span>
                  );
                })}
                {dayBk.length > 5 && <span style={{ fontSize: 10, color: "var(--muted)" }}>+{dayBk.length - 5} more</span>}
              </div>
            );
          })}
        </div>
      </div>
      <div className={`wb-panel wb-daypanel ${mobileDayOpen ? "open" : ""}`}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{fmtDate(selectedDay)}</div>
          <button className="wb-daypanel-close" onClick={() => setMobileDayOpen(false)} title="Close"><X size={18} /></button>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>{dayBookings.length} booking{dayBookings.length !== 1 ? "s" : ""}</div>
        {dayBookings.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>No bookings this day yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {dayBookings.map((b) => {
            const jt = jobTypes.find((j) => j.id === b.jobTypeId);
            const extraJts = (b.extraJobTypeIds || []).map((id) => jobTypes.find((j) => j.id === id)).filter(Boolean);
            const combinedParts = fullBookingBom(b, jobTypes);
            return (
              <div key={b.id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, background: "var(--panel2)" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: bookingStatus(b).color || "var(--text)" }}>
                    {b.customerName || "Unnamed"}
                  </div>
                  <TrafficLightButtons booking={b} updateBooking={updateBooking} onMarkArrived={setIntakeBooking} />
                  {/* Left-aligned, directly under the name — not pushed to the far right edge of
                      the card, which was unreachable one-handed on the mobile/iPad layout. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <button
                      onClick={() => {
                        if (!b.jobValue) { alert("Set a job value before sending the WhatsApp confirmation — it becomes the record of the agreed price."); return; }
                        if (!b.phone) { alert("This booking has no phone number set."); return; }
                        window.open(whatsappLink(b.phone, confirmationMessage(b)), "_blank");
                      }}
                      title="Send WhatsApp confirmation"
                      style={{ background: "none", border: "none", color: "#25D366", cursor: "pointer", display: "flex" }}
                    >
                      <MessageCircle size={15} />
                    </button>
                    <button onClick={() => onEditBooking(b)} title="Edit booking" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><PenLine size={13} /></button>
                    <button onClick={() => onPrintJob(b)} title="Print job card" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><Printer size={13} /></button>
                    <button onClick={() => removeBooking(b.id)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={13} /></button>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--amber2)", marginTop: 2 }}>
                  {jt?.name || "—"}{extraJts.length > 0 && ` + ${extraJts.map((e) => e.name).join(" + ")}`}
                </div>
                {b.days > 1 && (
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    {selectedDay === b.date ? `In for ${b.days} days (${fmtDate(b.date)} – ${fmtDate(addDaysISO(b.date, b.days - 1))})` : `Day ${bookingDates(b).indexOf(selectedDay) + 1} of ${b.days}`}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                  {b.phone && <span><Phone size={10} style={{ display: "inline", marginRight: 4 }} />{b.phone}</span>}
                  {b.reg && <span><Car size={10} style={{ display: "inline", marginRight: 4 }} />{b.reg}</span>}
                  {b.symptoms && <span><FileText size={10} style={{ display: "inline", marginRight: 4 }} />{b.symptoms}</span>}
                  {b.business === "Timing Chain Specialists" && b.postcode && (
                    <span><Truck size={10} style={{ display: "inline", marginRight: 4 }} />Collection — {b.postcode} {typeof b.distanceMiles === "number" ? `(~${b.distanceMiles} mi)` : ""}
                      {typeof b.distanceMiles === "number" && (b.distanceMiles <= 150 ? <span style={{ color: "var(--green)" }}> · free</span> : <span style={{ color: "var(--red)" }}> · quote needed</span>)}
                    </span>
                  )}
                  <span style={{ fontSize: 10 }}>{b.business}</span>
                </div>
                {combinedParts.length > 0 && (
                  <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>Parts used</div>
                    <div className="wh-mono" style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 1 }}>
                      {combinedParts.map((l) => <span key={l.partId}>{l.qty}× {partsIndex[l.partId] || l.partId}</span>)}
                    </div>
                  </div>
                )}
                <JobCostBlock booking={b} jt={jt} jobTypes={jobTypes} parts={parts} settings={settings} updateBooking={updateBooking} />
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                  Find this vehicle by reg (<strong className="wh-mono">{b.reg || "no reg"}</strong>) under Workshop mode to open its job card.
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </div>
      {intakeBooking && (
        <IntakeConfirmationModal
          booking={intakeBooking}
          jobTypes={jobTypes}
          onClose={() => setIntakeBooking(null)}
          onConfirmed={() => setIntakeBooking(null)}
        />
      )}
    </div>
  );
}

// A scannable list of every job and its traffic-light status, for when
// clicking through the calendar day by day is slower than just wanting to
// see what's in, what's done, and what's ready to collect. Hides collected
// jobs by default — those are done and out the door — but they're a tick
// away.
function JobsTableTab({ bookings, jobTypes, onOpenBooking }) {
  const [showCollected, setShowCollected] = useState(false);
  const jtIndex = useMemo(() => Object.fromEntries(jobTypes.map((j) => [j.id, j.name])), [jobTypes]);
  const rows = useMemo(() => {
    return bookings
      .filter((b) => showCollected || !b.completed)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [bookings, showCollected]);

  return (
    <div className="wb-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Jobs</div>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={showCollected} onChange={(e) => setShowCollected(e.target.checked)} /> Show collected
        </label>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="wb-table">
          <thead>
            <tr><th>Date</th><th>Customer</th><th>Reg</th><th>Business</th><th>Job type</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const st = bookingStatus(b);
              return (
                <tr key={b.id} onClick={() => onOpenBooking(b)} style={{ cursor: "pointer" }}>
                  <td>{fmtDate(b.date)}</td>
                  <td>{b.customerName || "Unnamed"}</td>
                  <td className="wh-mono">{b.reg || "—"}</td>
                  <td>{b.business}</td>
                  <td>{jtIndex[b.jobTypeId] || "—"}</td>
                  <td><span style={{ color: st.color || "var(--muted)", fontWeight: 700 }}>{st.label}</span></td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No jobs to show.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Technician-flagged extra work waiting on office to price, mark whether
// it's in stock, and send the AI-written distance approval report. Nothing
// reaches the customer until office fills in price and hits send — the
// technician's job is only to describe what was found.
function PendingApprovalBanner({ jobApprovals, jobCards, bookings, jobTypes, updateJobApproval, removeJobApproval }) {
  const pending = useMemo(() => jobApprovals.filter((a) => a.status === "draft"), [jobApprovals]);
  const [drafts, setDrafts] = useState({});
  const [sendingId, setSendingId] = useState(null);
  const [errorId, setErrorId] = useState(null);

  if (pending.length === 0) return null;

  const setDraft = (id, patch) => setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const send = async (approval) => {
    const draft = drafts[approval.id] || {};
    const price = Number(draft.price);
    if (!price || price <= 0) { setErrorId(approval.id); return; }
    setErrorId(null);
    setSendingId(approval.id);
    try {
      const res = await fetch("/api/office/send-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id, price, inStock: !!draft.inStock }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Failed to send the approval report."); setSendingId(null); return; }
      // Optimistic — realtime will bring in the server's ai_writeup/status once it lands.
      updateJobApproval(approval.id, { price, inStock: !!draft.inStock, status: "sent", sentAt: Date.now() });

      // A brand-new sending domain is more likely to land in spam, so also
      // nudge the customer over WhatsApp to go check their email.
      const card = jobCards.find((c) => c.id === approval.jobCardId);
      const booking = bookings.find((b) => b.id === approval.bookingId);
      if (booking?.phone) {
        const cardVehicle = [card?.make, card?.model].filter(Boolean).join(" ");
        const msg = `Hi ${firstName(card?.customerName || booking.customerName)}, we've found some extra work needed on your ${cardVehicle || booking.vehicleModel || "vehicle"} while carrying out the booked job. We've just emailed you the details along with a link to approve or decline — could you take a look when you get a chance?`;
        window.open(whatsappLink(booking.phone, msg), "_blank");
      }
    } catch {
      alert("Failed to send the approval report — check your connection and try again.");
    }
    setSendingId(null);
  };

  return (
    <div className="wb-panel" style={{ borderColor: "var(--amber)" }}>
      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "var(--amber2)" }}>
        <AlertTriangle size={15} /> {pending.length} extra-work request{pending.length !== 1 ? "s" : ""} waiting on a price
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {pending.map((a) => {
          const card = jobCards.find((c) => c.id === a.jobCardId);
          const booking = bookings.find((b) => b.id === a.bookingId);
          const jt = booking && jobTypes.find((j) => j.id === booking.jobTypeId);
          const draft = drafts[a.id] || {};
          return (
            <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, background: "var(--panel2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                <div>
                  <strong style={{ fontSize: 13 }}>{card?.customerName || "Unknown customer"}</strong>{" "}
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{card?.reg ? `— ${card.reg}` : ""}{jt ? ` · ${jt.name}` : ""}</span>
                </div>
                <button onClick={() => { if (confirm("Discard this extra-work request? The technician's note will be deleted.")) removeJobApproval(a.id); }} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button>
              </div>
              <div style={{ fontSize: 12, color: "var(--text)", marginBottom: 10, whiteSpace: "pre-wrap" }}>{a.description}</div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <input type="number" min="0" step="0.01" placeholder="Price £" className="wb-input" style={{ width: 100 }}
                  value={draft.price ?? ""} onChange={(e) => setDraft(a.id, { price: e.target.value })} />
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!draft.inStock} onChange={(e) => setDraft(a.id, { inStock: e.target.checked })} />
                  In stock — can be done while it's in
                </label>
                <button className="wb-btn" style={{ padding: "8px 12px", minHeight: 32, marginLeft: "auto" }} disabled={sendingId === a.id} onClick={() => send(a)}>
                  {sendingId === a.id ? "Sending…" : "Generate & send"}
                </button>
              </div>
              {errorId === a.id && <div style={{ color: "var(--red)", fontSize: 11, marginTop: 6 }}>Enter a price before sending.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Shows any booking due its 2-days-before reminder: within the next 2 days,
// originally booked with more than 2 days' notice, and not already sent.
function TwoDayReminderBanner({ bookings, updateBooking }) {
  const candidates = useMemo(() => reminderCandidates(bookings), [bookings]);
  if (candidates.length === 0) return null;

  const send = (b) => {
    window.open(whatsappLink(b.phone, reminderMessage(b)), "_blank");
    updateBooking(b.id, { reminderSent: true });
  };

  return (
    <div className="wb-panel" style={{ borderColor: "var(--amber)" }}>
      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "var(--amber2)" }}>
        <AlertTriangle size={15} /> {candidates.length} booking{candidates.length !== 1 ? "s" : ""} due a reminder
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {candidates.map((b) => (
          <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13 }}>
              <strong>{b.customerName || "Unnamed"}</strong> <span style={{ color: "var(--muted)" }}>— in on {fmtDate(b.date)}</span>
            </div>
            <button className="wb-btn-ghost" style={{ padding: "8px 12px", minHeight: 32 }} onClick={() => send(b)}>
              <MessageCircle size={13} /> Send WhatsApp reminder
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Bookings marked complete 2+ days ago, due a check-in + review-request message.
function FollowUpBanner({ bookings, updateBooking }) {
  const candidates = useMemo(() => followUpCandidates(bookings), [bookings]);
  if (candidates.length === 0) return null;

  const send = (b) => {
    window.open(whatsappLink(b.phone, followUpMessage(b)), "_blank");
    updateBooking(b.id, { followupSent: true });
  };

  return (
    <div className="wb-panel" style={{ borderColor: "var(--green)" }}>
      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "var(--green)" }}>
        <Check size={15} /> {candidates.length} booking{candidates.length !== 1 ? "s" : ""} due a follow-up
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {candidates.map((b) => (
          <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13 }}>
              <strong>{b.customerName || "Unnamed"}</strong> <span style={{ color: "var(--muted)" }}>— collected {fmtDate(new Date(b.completedAt).toISOString().slice(0, 10))}</span>
            </div>
            <button className="wb-btn-ghost" style={{ padding: "8px 12px", minHeight: 32 }} onClick={() => send(b)}>
              <MessageCircle size={13} /> Send WhatsApp follow-up
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Bookings marked complete 4+ days ago, due the dedicated review check —
// separate from the softer 2-day check-in above. Lets Office record either
// that the reminder was sent, or that the customer had already left a
// review, without sending anything in the latter case.
function ReviewFollowUpBanner({ bookings, updateBooking }) {
  const candidates = useMemo(() => reviewFollowUpCandidates(bookings), [bookings]);
  if (candidates.length === 0) return null;

  const send = (b) => {
    window.open(whatsappLink(b.phone, reviewFollowUpMessage(b)), "_blank");
    updateBooking(b.id, { reviewFollowupDone: true });
  };
  const markAlreadyReviewed = (b) => updateBooking(b.id, { reviewFollowupDone: true });

  return (
    <div className="wb-panel" style={{ borderColor: "var(--amber)" }}>
      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "var(--amber2)" }}>
        <AlertTriangle size={15} /> {candidates.length} booking{candidates.length !== 1 ? "s" : ""} due a review check
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {candidates.map((b) => (
          <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13 }}>
              <strong>{b.customerName || "Unnamed"}</strong> <span style={{ color: "var(--muted)" }}>— completed {fmtDate(new Date(b.completedAt).toISOString().slice(0, 10))} · {b.business}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="wb-btn-ghost" style={{ padding: "8px 12px", minHeight: 32 }} onClick={() => markAlreadyReviewed(b)}>Already reviewed</button>
              <button className="wb-btn-ghost" style={{ padding: "8px 12px", minHeight: 32 }} onClick={() => send(b)}>
                <MessageCircle size={13} /> Send review reminder
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Parts cost for a job type's recipe, priced from the Stock tab's cost prices.
function partsCostForJobType(jt, parts) {
  return jt ? jt.bom.reduce((sum, l) => { const p = parts.find((x) => x.id === l.partId); return sum + (p?.costPrice || 0) * l.qty; }, 0) : 0;
}
// A booking's main job type plus any extras added on top (e.g. Timing Chain
// Replacement + Single Turbo (Recon) on the same vehicle).
function bookingJobTypeIds(booking) {
  return [booking.jobTypeId, ...(booking.extraJobTypeIds || [])].filter(Boolean);
}
// Combined recipe across every job type on a booking, parts aggregated by id
// so 1x oil filter from two different recipes shows as one 2x line.
function combinedBom(jobTypeIds, jobTypes) {
  const qtyByPart = {};
  jobTypeIds.forEach((id) => {
    const jt = jobTypes.find((j) => j.id === id);
    jt?.bom.forEach((l) => { qtyByPart[l.partId] = (qtyByPart[l.partId] || 0) + l.qty; });
  });
  return Object.entries(qtyByPart).map(([partId, qty]) => ({ partId, qty }));
}
// Full recipe for a booking: main + extra job types, plus any one-off extra
// parts added straight from Stock (folded into the same part if it overlaps),
// then any per-booking quantity overrides win outright — a part whose real
// quantity varies by vehicle (e.g. Followers: some cars take 3, some 6)
// shouldn't be stuck at the job type's fixed template default.
function fullBookingBom(booking, jobTypes) {
  const qtyByPart = Object.fromEntries(combinedBom(bookingJobTypeIds(booking), jobTypes).map((l) => [l.partId, l.qty]));
  (booking.extraParts || []).forEach((l) => { qtyByPart[l.partId] = (qtyByPart[l.partId] || 0) + l.qty; });
  (booking.bomQtyOverrides || []).forEach((l) => { qtyByPart[l.partId] = l.qty; });
  return Object.entries(qtyByPart).filter((l) => l[1] > 0).map(([partId, qty]) => ({ partId, qty }));
}
function partsCostForBooking(booking, jobTypes, parts) {
  return fullBookingBom(booking, jobTypes).reduce((sum, l) => { const p = parts.find((x) => x.id === l.partId); return sum + (p?.costPrice || 0) * l.qty; }, 0);
}
// Shared by the per-booking cost block and the Profitability tab's rollup.
function computeProfit({ jobValue, labourCost, transportCost, partsCost, vatRegistered }) {
  const vat = vatRegistered ? jobValue - jobValue / 1.2 : 0;
  return { vat, profit: jobValue - vat - partsCost - labourCost - transportCost };
}

function JobCostBlock({ booking, jt, jobTypes, parts, settings, updateBooking }) {
  const [open, setOpen] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const partsCost = useMemo(() => partsCostForBooking(booking, jobTypes, parts), [booking, jobTypes, parts]);
  const jobValue = booking.jobValue || 0, labourCost = booking.labourCost || 0, transportCost = booking.transportCost || 0;
  const { vat, profit } = computeProfit({ jobValue, labourCost, transportCost, partsCost, vatRegistered: settings.vatRegistered });
  const needsQuote = booking.business === "Timing Chain Specialists" && typeof booking.distanceMiles === "number" && booking.distanceMiles > 150;
  const draftQuoteEmail = () => {
    const recipients = (settings.transportCompanies || []).map((c) => c.email).filter(Boolean).join(",");
    const subject = encodeURIComponent(`Collection quote — ${booking.customerName || "customer"} — ${booking.reg || ""}`);
    const body = encodeURIComponent(`Hi,\n\nCould you quote to collect and return a customer vehicle for us?\n\nCustomer: ${booking.customerName || ""}\nVehicle registration: ${booking.reg || ""}\nPickup postcode: ${booking.postcode || ""}\nApprox distance: ${booking.distanceMiles || "?"} miles\nJob date: ${booking.date}\nJob type: ${jt?.name || ""}\n\nPlease treat this vehicle with care — it's the customer's own car.\n\nThanks,\nThe Timing Chain Specialists`);
    window.open(`mailto:${recipients}?subject=${subject}&body=${body}`, "_blank");
  };
  const messageTransport = () => {
    if (!settings.transportContactPhone) { alert(`Add a phone number for ${settings.transportContactName || "the transport contact"} in Settings first.`); return; }
    window.open(whatsappLink(settings.transportContactPhone, transportPriceRequestMessage(booking, settings.transportContactName)), "_blank");
  };
  const createZohoInvoice = async () => {
    setCreatingInvoice(true);
    try {
      // One invoice line per job type on the booking (Timing Chain Replacement,
      // Piston Cooling Jet Solenoid, etc. each priced separately) — never split
      // further into the individual parts within a job type. A booking saved
      // before the pricing breakdown existed falls back to one line for the
      // whole total.
      const lineItems = booking.jobTypePrices?.length
        ? booking.jobTypePrices.map((p) => ({ name: jobTypes.find((j) => j.id === p.jobTypeId)?.name || p.jobTypeId, amount: p.price }))
        : [{ name: jt?.name || "Workshop job", amount: booking.jobValue }];
      const res = await fetch("/api/office/zoho-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business: booking.business, customerName: booking.customerName, phone: booking.phone,
          jobValue: booking.jobValue, reg: booking.reg, lineItems,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.error || "Zoho invoice creation failed."); return; }
      updateBooking(booking.id, { zohoInvoiceId: data.invoiceId, zohoInvoiceNumber: data.invoiceNumber, zohoInvoiceUrl: data.invoiceUrl });
    } catch (e) {
      alert("Zoho invoice creation failed — network error.");
    }
    setCreatingInvoice(false);
  };
  return (
    <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <div style={{ fontSize: 10, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}><PoundSterling size={10} /> Job value & profit</div>
        <div className="wh-mono" style={{ fontSize: 11, color: profit >= 0 ? "var(--green)" : "var(--red)" }}>{jobValue ? `£${profit.toFixed(2)} profit` : "not set"}</div>
      </div>
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <div><label className="wb-label">Job value £</label><input type="number" className="wb-input" value={booking.jobValue || ""} onChange={(e) => updateBooking(booking.id, { jobValue: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="wb-label">Labour £</label><input type="number" className="wb-input" value={booking.labourCost || ""} onChange={(e) => updateBooking(booking.id, { labourCost: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="wb-label">Transport £</label><input type="number" className="wb-input" value={booking.transportCost || ""} onChange={(e) => updateBooking(booking.id, { transportCost: parseFloat(e.target.value) || 0 })} /></div>
          </div>
          <div className="wh-mono" style={{ fontSize: 11, color: "var(--muted)" }}>Parts cost: £{partsCost.toFixed(2)}{settings.vatRegistered ? ` · VAT: £${vat.toFixed(2)}` : ""}</div>
          {isTimingChainReplacement(jt) && !booking.jobValue && (
            <button className="wb-btn-ghost" onClick={() => updateBooking(booking.id, STANDARD_TIMING_CHAIN_PRICE)}>Use standard timing chain pricing</button>
          )}
          {needsQuote && <button className="wb-btn-ghost" onClick={draftQuoteEmail}><Mail size={12} /> Draft transport quote request</button>}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={!!booking.transportRequired} onChange={(e) => updateBooking(booking.id, { transportRequired: e.target.checked })} /> Transport required
          </label>
          {booking.transportRequired && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "var(--panel2)", borderRadius: 6, padding: 8 }}>
              <button className="wb-btn-ghost" onClick={messageTransport}>
                <MessageCircle size={12} /> Message {settings.transportContactName || "transport"} for price & availability
              </button>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 11, color: booking.transportConfirmed === true ? "var(--green)" : booking.transportConfirmed === false ? "var(--red)" : "var(--muted)" }}>
                  {booking.transportConfirmed === true ? "Confirmed" : booking.transportConfirmed === false ? "Declined" : "Awaiting reply"}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="wb-btn-ghost"
                    style={{ padding: "6px 10px", minHeight: "auto", ...(booking.transportConfirmed === true ? { borderColor: "var(--green)", color: "var(--green)" } : {}) }}
                    onClick={() => updateBooking(booking.id, { transportConfirmed: true })}
                  >
                    Confirmed
                  </button>
                  <button
                    className="wb-btn-ghost"
                    style={{ padding: "6px 10px", minHeight: "auto", ...(booking.transportConfirmed === false ? { borderColor: "var(--red)", color: "var(--red)" } : {}) }}
                    onClick={() => updateBooking(booking.id, { transportConfirmed: false })}
                  >
                    Declined
                  </button>
                </div>
              </div>
            </div>
          )}
          {booking.workshopCompleted && (
            booking.zohoInvoiceId ? (
              <a href={booking.zohoInvoiceUrl} target="_blank" rel="noopener noreferrer" className="wb-btn-ghost" style={{ textDecoration: "none", textAlign: "center", color: "var(--green)" }}>
                <Check size={12} style={{ display: "inline", marginRight: 4 }} />Zoho invoice {booking.zohoInvoiceNumber ? `#${booking.zohoInvoiceNumber}` : ""} created
              </a>
            ) : (
              <button className="wb-btn-ghost" onClick={createZohoInvoice} disabled={creatingInvoice || !booking.jobValue}>
                {creatingInvoice ? "Creating…" : "Create Zoho invoice"}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// Same cost/profit maths as JobCostBlock, applied across every priced
// booking and rolled up by month. Unpriced bookings (no quote entered yet)
// are left out of the totals — they're not revenue yet — but counted
// separately so the numbers aren't silently missing jobs.
function bookingProfit(booking, jobTypes, parts, settings) {
  const jt = jobTypes.find((j) => j.id === booking.jobTypeId);
  const partsCost = partsCostForBooking(booking, jobTypes, parts);
  const jobValue = booking.jobValue || 0, labourCost = booking.labourCost || 0, transportCost = booking.transportCost || 0;
  const { vat, profit } = computeProfit({ jobValue, labourCost, transportCost, partsCost, vatRegistered: settings.vatRegistered });
  return { jt, partsCost, jobValue, labourCost, transportCost, vat, profit };
}

// Second password gate, independent of the main site login — so profit
// figures stay hidden from anyone who only has the shared Office password.
// The session lives in its own httpOnly cookie, checked server-side.
function ProfitabilityGate({ children }) {
  const [status, setStatus] = useState("checking"); // checking | locked | unlocked
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/profit-check").then((r) => r.json()).then((d) => setStatus(d.authenticated ? "unlocked" : "locked"));
  }, []);

  const submit = async () => {
    setError("");
    const res = await fetch("/api/profit-login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
    });
    if (res.ok) { setStatus("unlocked"); setPassword(""); }
    else setError("Wrong password");
  };

  const lock = async () => {
    await fetch("/api/profit-logout", { method: "POST" });
    setPassword("");
    setStatus("locked");
  };

  if (status === "checking") return null;

  if (status === "locked") {
    return (
      <div className="wb-panel" style={{ maxWidth: 340, margin: "60px auto", textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Lock size={16} /> Profitability is locked
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Enter the password to view job pricing and profit.</div>
        <input
          type="password" className="wb-input" value={password} placeholder="Password"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {error && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 8 }}>{error}</div>}
        <button className="wb-btn" style={{ marginTop: 12, width: "100%", justifyContent: "center" }} onClick={submit}>Unlock</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button className="wb-btn-ghost" onClick={lock}><Lock size={13} /> Lock</button>
      </div>
      {children}
    </div>
  );
}

function ProfitabilityTab({ bookings, jobTypes, parts, settings }) {
  const months = useMemo(() => {
    const priced = bookings.filter((b) => (b.jobValue || 0) > 0);
    const completed = priced.filter((b) => b.completed);
    const unpricedCount = bookings.length - priced.length;
    const notYetCompleteCount = priced.length - completed.length;
    const byMonth = {};
    completed.forEach((b) => {
      const key = b.date.slice(0, 7);
      byMonth[key] = byMonth[key] || [];
      byMonth[key].push({ booking: b, ...bookingProfit(b, jobTypes, parts, settings) });
    });
    const monthList = Object.keys(byMonth).sort().reverse().map((key) => {
      const rows = byMonth[key].sort((a, b) => (a.booking.date < b.booking.date ? 1 : -1));
      const totals = rows.reduce((acc, r) => ({
        jobValue: acc.jobValue + r.jobValue, partsCost: acc.partsCost + r.partsCost,
        labourCost: acc.labourCost + r.labourCost, transportCost: acc.transportCost + r.transportCost,
        vat: acc.vat + r.vat, profit: acc.profit + r.profit,
      }), { jobValue: 0, partsCost: 0, labourCost: 0, transportCost: 0, vat: 0, profit: 0 });
      const label = new Date(`${key}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      return { key, label, rows, totals };
    });
    return { monthList, unpricedCount, notYetCompleteCount };
  }, [bookings, jobTypes, parts, settings]);

  const grandTotal = months.monthList.reduce((acc, m) => ({
    jobValue: acc.jobValue + m.totals.jobValue, partsCost: acc.partsCost + m.totals.partsCost,
    labourCost: acc.labourCost + m.totals.labourCost, transportCost: acc.transportCost + m.totals.transportCost,
    profit: acc.profit + m.totals.profit,
  }), { jobValue: 0, partsCost: 0, labourCost: 0, transportCost: 0, profit: 0 });

  const exportExcel = () => {
    const rows = [["Month", "Date", "Customer", "Registration", "Job type", "Quoted", "Parts cost", "Labour", "Transport", "Profit"]];
    months.monthList.forEach((m) => {
      m.rows.forEach((r) => rows.push([m.label, r.booking.date, r.booking.customerName || "Unnamed", r.booking.reg || "", r.jt?.name || "", r.jobValue, r.partsCost, r.labourCost, r.transportCost, r.profit]));
      rows.push([m.label + " total", "", "", "", "", m.totals.jobValue, m.totals.partsCost, m.totals.labourCost, m.totals.transportCost, m.totals.profit]);
      rows.push([]);
    });
    rows.push(["Grand total", "", "", "", "", grandTotal.jobValue, grandTotal.partsCost, grandTotal.labourCost, grandTotal.transportCost, grandTotal.profit]);
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Profitability");
    XLSX.writeFile(workbook, `profitability-${todayISO()}.xlsx`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="wb-panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}><PoundSterling size={16} color="var(--amber)" /> Profitability</div>
          <div className="wh-mono" style={{ fontSize: 13, color: grandTotal.profit >= 0 ? "var(--green)" : "var(--red)" }}>
            £{grandTotal.profit.toFixed(2)} total profit across £{grandTotal.jobValue.toFixed(2)} quoted
          </div>
          <button className="wb-btn-ghost" onClick={exportExcel} disabled={months.monthList.length === 0}><FileText size={13} /> Export to Excel</button>
        </div>
        {(months.unpricedCount > 0 || months.notYetCompleteCount > 0) && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            {months.unpricedCount > 0 && <span>{months.unpricedCount} booking{months.unpricedCount !== 1 ? "s" : ""} without a price entered yet. </span>}
            {months.notYetCompleteCount > 0 && <span>{months.notYetCompleteCount} priced booking{months.notYetCompleteCount !== 1 ? "s" : ""} not yet marked collected. </span>}
            None of these are counted here — add a job value and mark it collected on the Calendar tab to include it.
          </div>
        )}
      </div>

      {months.monthList.length === 0 && (
        <div className="wb-panel" style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "30px 0" }}>
          No priced jobs yet. Add a job value to a booking on the Calendar tab to see it here.
        </div>
      )}

      {months.monthList.map((m) => (
        <div key={m.key} className="wb-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{m.label}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{m.rows.length} job{m.rows.length !== 1 ? "s" : ""}</div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="wb-table">
              <thead><tr><th>Date</th><th>Customer</th><th>Job type</th><th>Quoted</th><th>Parts cost</th><th>Labour</th><th>Transport</th><th>Profit</th></tr></thead>
              <tbody>
                {m.rows.map((r) => (
                  <tr key={r.booking.id}>
                    <td className="wh-mono">{r.booking.date}</td>
                    <td>{r.booking.customerName || "Unnamed"} <span style={{ color: "var(--muted)" }}>{r.booking.reg}</span></td>
                    <td>{r.jt?.name || "—"}</td>
                    <td className="wh-mono">£{r.jobValue.toFixed(2)}</td>
                    <td className="wh-mono">£{r.partsCost.toFixed(2)}</td>
                    <td className="wh-mono">£{r.labourCost.toFixed(2)}</td>
                    <td className="wh-mono">£{r.transportCost.toFixed(2)}</td>
                    <td className="wh-mono" style={{ color: r.profit >= 0 ? "var(--green)" : "var(--red)" }}>£{r.profit.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={3}>Total</td>
                  <td className="wh-mono">£{m.totals.jobValue.toFixed(2)}</td>
                  <td className="wh-mono">£{m.totals.partsCost.toFixed(2)}</td>
                  <td className="wh-mono">£{m.totals.labourCost.toFixed(2)}</td>
                  <td className="wh-mono">£{m.totals.transportCost.toFixed(2)}</td>
                  <td className="wh-mono" style={{ color: m.totals.profit >= 0 ? "var(--green)" : "var(--red)" }}>£{m.totals.profit.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function StockTab({ stockRows, jobTypes, receiveStock, updatePartField, removePart, stockBatches, orderStock, deliverStock, priceHistory, recordPrice }) {
  const [receiveAmounts, setReceiveAmounts] = useState({});
  const [orderAmounts, setOrderAmounts] = useState({}); // { [partId]: { qty, price } }
  const [historyPart, setHistoryPart] = useState(null);
  const [priceCheckOpen, setPriceCheckOpen] = useState(false);
  const pendingByPart = useMemo(() => {
    const map = {};
    stockBatches.filter((b) => b.status === "ordered").forEach((b) => { map[b.partId] = map[b.partId] || []; map[b.partId].push(b); });
    return map;
  }, [stockBatches]);
  const daysAgo = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));
  const renamePart = (r) => { const name = prompt("Rename part:", r.name); if (!name || !name.trim()) return; updatePartField(r.id, { name: name.trim() }); };
  const deletePartClick = (r) => {
    const usedIn = jobTypes.filter((jt) => jt.bom.some((l) => l.partId === r.id)).map((jt) => jt.name);
    const warning = usedIn.length
      ? `"${r.name}" is used in ${usedIn.length} job type${usedIn.length !== 1 ? "s" : ""} (${usedIn.join(", ")}) — deleting it will remove it from those recipes too. `
      : "";
    if (!confirm(`${warning}Delete "${r.name}"?`)) return;
    removePart(r.id);
  };

  const exportPriceHistory = () => {
    const rows = [["Part", "Part number", "Date", "Price", "Qty ordered", "Supplier", "Change vs previous"]];
    stockRows.forEach((r) => {
      const forPart = priceHistory.filter((h) => h.partId === r.id).sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));
      forPart.forEach((h, i) => {
        const delta = i > 0 ? h.price - forPart[i - 1].price : "";
        rows.push([r.name, r.partNumber || "", new Date(h.recordedAt).toLocaleDateString("en-GB"), h.price, h.qty ?? "", h.supplier || "", delta]);
      });
    });
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Price history");
    XLSX.writeFile(workbook, `price-history-${todayISO()}.xlsx`);
  };

  return (
    <div className="wb-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}><Package size={16} color="var(--amber)" /> Stock levels</div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>Usage from last 28 days · flags when cover &lt; {REORDER_WEEKS} week</div>
        <button className="wb-btn-ghost" onClick={exportPriceHistory} disabled={priceHistory.length === 0}><FileText size={13} /> Export price history</button>
        <button className="wb-btn-ghost" onClick={() => setPriceCheckOpen(true)}><Search size={13} /> Find cheapest price</button>
      </div>
      <div style={{ overflowX: "auto" }}>
      <table className="wb-table">
        <thead><tr><th>Part</th><th>Part no.</th><th>Physical stock</th><th>Weekly usage</th><th>Weeks cover</th><th>Cost price</th><th>Status</th><th>On order / due in</th><th>Order stock</th><th>Correct</th><th></th></tr></thead>
        <tbody>
          {stockRows.map((r) => (
            <tr key={r.id}>
              <td style={{ fontWeight: 600 }}>
                {r.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({r.unit})</span>
                <button onClick={() => renamePart(r)} title="Rename part" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", marginLeft: 6, verticalAlign: "middle" }}><PenLine size={12} /></button>
              </td>
              <td>
                <input
                  type="text" className="wb-input" style={{ width: 110 }} placeholder="e.g. LR073816" value={r.partNumber || ""}
                  onChange={(e) => updatePartField(r.id, { partNumber: e.target.value })}
                />
              </td>
              <td className="wh-mono">{r.stock}</td>
              <td className="wh-mono">{r.weekly ? r.weekly.toFixed(1) : "0.0"}</td>
              <td className="wh-mono">{r.weeksLeft === Infinity ? "—" : r.weeksLeft.toFixed(1)}</td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="wh-mono">£{(r.costPrice ?? 0).toFixed(2)}</span>
                  <button onClick={() => setHistoryPart(r)} title="Price history" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><History size={14} /></button>
                </div>
              </td>
              <td>{r.needsOrder ? <span className="wb-badge-low"><AlertTriangle size={10} style={{ display: "inline", marginRight: 3 }} />Reorder</span> : <span className="wb-badge-ok"><Check size={10} style={{ display: "inline", marginRight: 3 }} />OK</span>}</td>
              <td>
                {(pendingByPart[r.id] || []).length === 0 ? (
                  <span style={{ color: "var(--muted)" }}>—</span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {pendingByPart[r.id].map((b) => {
                      const overdue = b.dueDate && b.dueDate < todayISO();
                      return (
                        <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, flexWrap: "wrap" }}>
                          <span className="wh-mono">{b.qtyOrdered} @ £{b.price.toFixed(2)}</span>
                          {b.supplier && <span style={{ color: "var(--muted)" }}>from {b.supplier}</span>}
                          <span style={{ color: "var(--muted)" }}>({daysAgo(b.orderedAt)}d ago)</span>
                          {b.dueDate && (
                            <span style={overdue ? { color: "var(--red)", fontWeight: 700 } : { color: "var(--muted)" }}>
                              {overdue && <AlertTriangle size={10} style={{ display: "inline", marginRight: 2 }} />}
                              due {fmtDate(b.dueDate)}
                            </span>
                          )}
                          <button className="wb-btn-ghost" style={{ padding: "4px 8px", minHeight: 26, fontSize: 11, whiteSpace: "nowrap" }} onClick={() => deliverStock(b.id)}>
                            <Truck size={11} style={{ display: "inline", marginRight: 3 }} />Delivered
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </td>
              <td>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <input type="number" className="wb-input" style={{ width: 55 }} placeholder="qty" value={orderAmounts[r.id]?.qty || ""} onChange={(e) => setOrderAmounts((prev) => ({ ...prev, [r.id]: { ...prev[r.id], qty: e.target.value } }))} />
                  <input type="number" step="0.01" className="wb-input" style={{ width: 70 }} placeholder="£ price" value={orderAmounts[r.id]?.price || ""} onChange={(e) => setOrderAmounts((prev) => ({ ...prev, [r.id]: { ...prev[r.id], price: e.target.value } }))} />
                  <input type="text" className="wb-input" style={{ width: 100 }} placeholder="Ordered from" value={orderAmounts[r.id]?.supplier || ""} onChange={(e) => setOrderAmounts((prev) => ({ ...prev, [r.id]: { ...prev[r.id], supplier: e.target.value } }))} />
                  <input type="date" className="wb-input" style={{ width: 130 }} title="Due date" value={orderAmounts[r.id]?.dueDate || ""} onChange={(e) => setOrderAmounts((prev) => ({ ...prev, [r.id]: { ...prev[r.id], dueDate: e.target.value } }))} />
                  <button
                    className="wb-btn-ghost" style={{ padding: "8px 10px", minHeight: 36, whiteSpace: "nowrap" }}
                    onClick={() => {
                      const qty = parseFloat(orderAmounts[r.id]?.qty), price = parseFloat(orderAmounts[r.id]?.price);
                      if (!qty || qty <= 0 || !price || price < 0) return;
                      orderStock(r.id, qty, price, orderAmounts[r.id]?.dueDate || null, orderAmounts[r.id]?.supplier?.trim() || null);
                      setOrderAmounts((prev) => ({ ...prev, [r.id]: { qty: "", price: "", dueDate: "", supplier: "" } }));
                    }}
                  >Order</button>
                </div>
              </td>
              <td>
                <div style={{ display: "flex", gap: 6 }}>
                  <input type="number" className="wb-input" style={{ width: 60 }} placeholder="qty" value={receiveAmounts[r.id] || ""} onChange={(e) => setReceiveAmounts((prev) => ({ ...prev, [r.id]: e.target.value }))} />
                  <button className="wb-btn-ghost" style={{ padding: "8px 10px", minHeight: 36, whiteSpace: "nowrap" }} onClick={() => { const qty = parseFloat(receiveAmounts[r.id]); if (!qty || qty <= 0) return; receiveStock(r.id, qty); setReceiveAmounts((prev) => ({ ...prev, [r.id]: "" })); }}>Add</button>
                  <button className="wb-btn-ghost" style={{ padding: "8px 10px", minHeight: 36, whiteSpace: "nowrap" }} onClick={() => { const qty = parseFloat(receiveAmounts[r.id]); if (!qty || qty <= 0) return; receiveStock(r.id, -qty); setReceiveAmounts((prev) => ({ ...prev, [r.id]: "" })); }}>Remove</button>
                </div>
              </td>
              <td>
                <button onClick={() => deletePartClick(r)} title="Delete part" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {historyPart && (
        <PriceHistoryModal
          part={historyPart}
          history={priceHistory.filter((h) => h.partId === historyPart.id)}
          recordPrice={recordPrice}
          onClose={() => setHistoryPart(null)}
        />
      )}
      {priceCheckOpen && (
        <PartsPriceModal parts={stockRows} onClose={() => setPriceCheckOpen(false)} />
      )}
    </div>
  );
}

// Looks up the cheapest European price for a part number via /api/parts-price,
// which queries Google Shopping (SearchApi.io) across several EU markets —
// see parts-finder/README.md for why that route was chosen over scraping
// retailer sites directly (most block bots).
function PartsPriceModal({ parts, onClose }) {
  const [selectedPartId, setSelectedPartId] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const selectExisting = (id) => {
    setSelectedPartId(id);
    const p = parts.find((r) => r.id === id);
    if (p) {
      setPartNumber(p.partNumber || "");
      setDescription(p.name || "");
    }
  };

  const search = async () => {
    if (!partNumber.trim()) return;
    setStatus("loading");
    setErrorMsg("");
    setResult(null);
    try {
      const res = await fetch("/api/parts-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partNumber, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      setResult(data);
      setStatus("done");
    } catch (e) {
      setErrorMsg(e.message);
      setStatus("error");
    }
  };

  return (
    <div className="wb-modal-backdrop" onClick={onClose}>
      <div className="wb-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
            <Search size={16} color="var(--amber)" /> Find cheapest price
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <select className="wb-input" value={selectedPartId} onChange={(e) => selectExisting(e.target.value)}>
            <option value="">— Or pick an existing part —</option>
            {parts.filter((p) => p.partNumber).map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.partNumber})</option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="text" className="wb-input" style={{ width: 150 }} placeholder="OEM part number" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} />
            <input type="text" className="wb-input" style={{ flex: 1, minWidth: 150 }} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
            <button className="wb-btn" onClick={search} disabled={!partNumber.trim() || status === "loading"}>
              {status === "loading" ? "Searching…" : "Search"}
            </button>
          </div>

          {status === "loading" && (
            <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", padding: "12px 0" }}>
              Checking UK, DE, FR, IT, ES, NL and PL listings — this can take a few seconds…
            </div>
          )}

          {status === "error" && (
            <div style={{ color: "var(--red)", fontSize: 12 }}>{errorMsg}</div>
          )}

          {status === "done" && result && result.results.length === 0 && (
            <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", padding: "12px 0" }}>
              No listings found that actually match "{result.partNumber}" — {result.listingsFound} loosely-related result(s) were discarded as unreliable.
            </div>
          )}

          {status === "done" && result && result.results.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                Top {result.results.length} of {result.listingsFound} listing(s) that matched every word of "{result.partNumber}", cheapest first
              </div>
              {result.results.map((r, i) => (
                <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    £{r.priceBase.toFixed(2)}
                    <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>
                      {" "}({r.currencyOriginal} {r.priceOriginal.toFixed(2)})
                    </span>
                  </div>
                  <div style={{ fontSize: 13 }}>{r.source} — {r.country}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.title}</div>
                  {r.link && (
                    <a href={r.link} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>View listing</a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Append-only price ledger for one part: recording a new price both logs a
// row here and becomes the part's current cost price, so nothing overwrites
// — the old price just becomes history for trend analysis.
function PriceHistoryModal({ part, history, recordPrice, onClose }) {
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [supplier, setSupplier] = useState("");

  const chronological = useMemo(() => [...history].sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1)), [history]);
  const newestFirst = useMemo(() => [...chronological].reverse(), [chronological]);

  const save = () => {
    const p = parseFloat(price);
    if (!p || p <= 0) return;
    recordPrice(part.id, p, qty ? parseFloat(qty) : null, supplier.trim());
    setPrice(""); setQty(""); setSupplier("");
  };

  return (
    <div className="wb-modal-backdrop" onClick={onClose}>
      <div className="wb-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
            <History size={16} color="var(--amber)" /> {part.name}{part.partNumber ? ` — ${part.partNumber}` : ""}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="number" step="0.01" className="wb-input" style={{ width: 100 }} placeholder="New price £" value={price} onChange={(e) => setPrice(e.target.value)} />
            <input type="number" className="wb-input" style={{ width: 100 }} placeholder="Qty ordered" value={qty} onChange={(e) => setQty(e.target.value)} />
            <input type="text" className="wb-input" style={{ flex: 1, minWidth: 130 }} placeholder="Supplier (optional)" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            <button className="wb-btn" onClick={save}>Save price</button>
          </div>

          {newestFirst.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", padding: "16px 0" }}>No price history recorded yet — add one above.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="wb-table">
                <thead><tr><th>Date</th><th>Price</th><th>Qty</th><th>Supplier</th><th>Change</th></tr></thead>
                <tbody>
                  {newestFirst.map((h) => {
                    const idx = chronological.findIndex((c) => c.id === h.id);
                    const prev = idx > 0 ? chronological[idx - 1] : null;
                    const delta = prev ? h.price - prev.price : 0;
                    return (
                      <tr key={h.id}>
                        <td className="wh-mono">{new Date(h.recordedAt).toLocaleDateString("en-GB")}</td>
                        <td className="wh-mono">£{h.price.toFixed(2)}</td>
                        <td className="wh-mono">{h.qty ?? "—"}</td>
                        <td>{h.supplier || "—"}</td>
                        <td>
                          {!prev ? <span style={{ color: "var(--muted)" }}><Minus size={12} style={{ display: "inline" }} /> first entry</span>
                            : delta > 0 ? <span style={{ color: "var(--red)" }}><TrendingUp size={12} style={{ display: "inline", verticalAlign: "middle" }} /> +£{delta.toFixed(2)}</span>
                            : delta < 0 ? <span style={{ color: "var(--green)" }}><TrendingDown size={12} style={{ display: "inline", verticalAlign: "middle" }} /> -£{Math.abs(delta).toFixed(2)}</span>
                            : <span style={{ color: "var(--muted)" }}><Minus size={12} style={{ display: "inline" }} /> no change</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JobTypesTab({ jobTypes, parts, addPart, addJobType, renameJobType, updateJobTypeColor, addBomLine, updateBomQty, removeBomLine }) {
  const addJobTypeClick = () => { const name = prompt("New job type name:"); if (!name) return; addJobType(name); };
  const renameJobTypeClick = (jtId) => { const jt = jobTypes.find((j) => j.id === jtId); const name = prompt("Rename job type:", jt.name); if (!name) return; renameJobType(jtId, name); };
  const addPartClick = () => { const name = prompt("New part name:"); if (!name) return; const unit = prompt("Unit (each / litre / kit):", "each") || "each"; addPart(name, unit); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="wb-btn-ghost" onClick={addPartClick}><Plus size={13} /> New part</button>
        <button className="wb-btn" onClick={addJobTypeClick}><Plus size={13} /> New job type</button>
      </div>
      {jobTypes.map((jt) => (
        <div key={jt.id} className="wb-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{jt.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Google Calendar colour</span>
              <div style={{ display: "flex", gap: 5 }}>
                {CALENDAR_COLORS.map((c) => (
                  <button
                    key={c.id}
                    title={c.name}
                    onClick={() => updateJobTypeColor(jt.id, c.id)}
                    style={{
                      width: 18, height: 18, borderRadius: "50%", background: c.hex, cursor: "pointer",
                      border: jt.color === c.id ? "2px solid var(--text)" : "1px solid var(--line)", padding: 0,
                    }}
                  />
                ))}
              </div>
              <button className="wb-btn-ghost" onClick={() => renameJobTypeClick(jt.id)}>Rename</button>
            </div>
          </div>
          <table className="wb-table">
            <thead><tr><th>Part</th><th style={{ width: 120 }}>Qty per job</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {jt.bom.map((l) => {
                const part = parts.find((p) => p.id === l.partId);
                return (
                  <tr key={l.partId}>
                    <td>{part?.name || l.partId} <span style={{ color: "var(--muted)" }}>({part?.unit})</span></td>
                    <td><input type="number" step="0.1" className="wb-input" value={l.qty} onChange={(e) => updateBomQty(jt.id, l.partId, parseFloat(e.target.value) || 0)} /></td>
                    <td><button onClick={() => removeBomLine(jt.id, l.partId)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={13} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}>
            <select className="wb-select" style={{ maxWidth: 280 }} onChange={(e) => { addBomLine(jt.id, e.target.value); e.target.value = ""; }} defaultValue="">
              <option value="" disabled>+ add part to this job…</option>
              {parts.filter((p) => !jt.bom.some((l) => l.partId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}

function SettingsTab({ settings, updateSettingsField }) {
  const updateCompany = (idx, field, val) => { const list = [...settings.transportCompanies]; list[idx] = { ...list[idx], [field]: val }; updateSettingsField({ transportCompanies: list }); };
  const addCompany = () => updateSettingsField({ transportCompanies: [...settings.transportCompanies, { name: "New transport company", email: "" }] });
  const removeCompany = (idx) => updateSettingsField({ transportCompanies: settings.transportCompanies.filter((_, i) => i !== idx) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Workshop & collection</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><label className="wb-label">Workshop postcode</label><input className="wb-input" value={settings.workshopPostcode} onChange={(e) => updateSettingsField({ workshopPostcode: e.target.value.toUpperCase() })} /></div>
          <div><label className="wb-label">"How collection works" page URL</label><input className="wb-input" placeholder="https://..." value={settings.collectionInfoUrl} onChange={(e) => updateSettingsField({ collectionInfoUrl: e.target.value })} /></div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={settings.vatRegistered} onChange={(e) => updateSettingsField({ vatRegistered: e.target.checked })} /> VAT registered
          </label>
        </div>
      </div>
      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Transport companies</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>Used for the transport quote request email.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {settings.transportCompanies.map((c, idx) => (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 32px", gap: 8 }}>
              <input className="wb-input" value={c.name} onChange={(e) => updateCompany(idx, "name", e.target.value)} placeholder="Company name" />
              <input className="wb-input" value={c.email} onChange={(e) => updateCompany(idx, "email", e.target.value)} placeholder="quotes@company.co.uk" />
              <button onClick={() => removeCompany(idx)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button>
            </div>
          ))}
        </div>
        <button className="wb-btn-ghost" style={{ marginTop: 10 }} onClick={addCompany}><Plus size={13} /> Add transport company</button>
      </div>
      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Transport pricing contact</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>Who "Transport required" on a booking sends a WhatsApp price-check to.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input className="wb-input" value={settings.transportContactName} onChange={(e) => updateSettingsField({ transportContactName: e.target.value })} placeholder="Name" />
          <input className="wb-input" value={settings.transportContactPhone} onChange={(e) => updateSettingsField({ transportContactPhone: e.target.value })} placeholder="Phone, e.g. 07911 123456" />
        </div>
      </div>
    </div>
  );
}

function NewBookingModal({ jobTypes, parts, settings, defaultDate, booking, onClose, onSave }) {
  const partsIndex = useMemo(() => Object.fromEntries(parts.map((p) => [p.id, p.name])), [parts]);
  const [pasteText, setPasteText] = useState("");
  const [customerName, setCustomerName] = useState(booking?.customerName || "");
  const [phone, setPhone] = useState(booking?.phone || "");
  const [email, setEmail] = useState(booking?.email || "");
  const [reg, setReg] = useState(booking?.reg || "");
  const [symptoms, setSymptoms] = useState(booking?.symptoms || "");
  const [business, setBusiness] = useState(booking?.business || BUSINESSES[0]);
  const [jobTypeId, setJobTypeId] = useState(booking?.jobTypeId || jobTypes[0]?.id || "");
  const [extraJobTypeIds, setExtraJobTypeIds] = useState(booking?.extraJobTypeIds || []);
  const [extraParts, setExtraParts] = useState(booking?.extraParts || []);
  const [bomQtyOverrides, setBomQtyOverrides] = useState(booking?.bomQtyOverrides || []);
  const [vehicleModel, setVehicleModel] = useState(booking?.vehicleModel || "");
  const [date, setDate] = useState(booking?.date || defaultDate);
  const [days, setDays] = useState(booking?.days || 1);
  const [pickupRequired, setPickupRequired] = useState(booking?.pickupRequired || false);
  const [pickupAddress, setPickupAddress] = useState(booking?.pickupAddress || "");
  const [postcode, setPostcode] = useState(booking?.postcode || "");
  const [distanceMiles, setDistanceMiles] = useState(booking?.distanceMiles ?? null);
  // Price per job type on this booking (main + each extra), keyed by job
  // type id — summed into the invoice total below. An existing booking with
  // no breakdown saved yet (from before this existed) falls back to putting
  // its whole current total on the main job type, rather than losing it.
  const [jobTypePrices, setJobTypePrices] = useState(() => {
    if (booking?.jobTypePrices?.length) return Object.fromEntries(booking.jobTypePrices.map((p) => [p.jobTypeId, p.price]));
    if (booking) return { [booking.jobTypeId]: booking.jobValue || 0 };
    return {};
  });
  // Pre-fills the standard Timing Chain Replacement price the moment that job
  // type is picked (main or extra) on a new booking — preserves whatever was
  // already typed for a job type if it's picked again, and never touches an
  // existing booking's already-agreed prices when editing.
  const priceForNewJobType = (id) => {
    const jt = jobTypes.find((j) => j.id === id);
    return isTimingChainReplacement(jt) ? STANDARD_TIMING_CHAIN_PRICE.jobValue : 0;
  };
  useEffect(() => {
    if (booking) return;
    setJobTypePrices((prev) => (jobTypeId in prev ? prev : { ...prev, [jobTypeId]: priceForNewJobType(jobTypeId) }));
  }, [jobTypeId]);
  const allJobTypeIds = [jobTypeId, ...extraJobTypeIds].filter(Boolean);
  const jobValue = allJobTypeIds.reduce((sum, id) => sum + (jobTypePrices[id] || 0), 0);
  // The job types' own default BOM lines — the quantity a technician can
  // override per booking below, for parts that genuinely vary by vehicle
  // (e.g. Followers: some cars take 3, some take 6) rather than being fixed
  // like a gasket or filter.
  const jobTypeBomLines = useMemo(() => combinedBom(allJobTypeIds, jobTypes), [jobTypeId, extraJobTypeIds.join(","), jobTypes]);
  const overrideQty = (partId) => bomQtyOverrides.find((l) => l.partId === partId)?.qty;
  const setOverrideQty = (partId, qty, defaultQty) => {
    setBomQtyOverrides((prev) => {
      const withoutThis = prev.filter((l) => l.partId !== partId);
      return qty === defaultQty ? withoutThis : [...withoutThis, { partId, qty }];
    });
  };
  const isTCS = business === "Timing Chain Specialists";
  const handlePostcodeChange = (val) => { setPostcode(val); setDistanceMiles(estimateDistanceMiles(settings.workshopPostcode, val)); };
  const withinFreeRadius = typeof distanceMiles === "number" ? distanceMiles <= 150 : null;
  const runParse = () => {
    const phoneFound = extractPhone(pasteText), regFound = extractReg(pasteText), emailFound = extractEmail(pasteText), nameGuess = guessName(pasteText, phoneFound);
    if (phoneFound) setPhone(phoneFound); if (regFound) setReg(regFound); if (emailFound) setEmail(emailFound); if (nameGuess) setCustomerName(nameGuess);
    setSymptoms(pasteText.trim());
  };
  const canSave = customerName.trim() && date && jobTypeId;

  return (
    <div className="wb-modal-backdrop" onClick={onClose}>
      <div className="wb-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{booking ? "Edit booking" : "New booking"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="wb-label"><ClipboardPaste size={11} style={{ display: "inline", marginRight: 4 }} />Paste WhatsApp message</label>
            <textarea className="wb-textarea" rows={4} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the customer's WhatsApp message here…" />
            <button className="wb-btn-ghost" style={{ marginTop: 6 }} onClick={runParse}>Extract details</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label className="wb-label">Customer name</label><input className="wb-input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
            <div><label className="wb-label">Phone</label><input className="wb-input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div><label className="wb-label">Email</label><input className="wb-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><label className="wb-label">Vehicle registration</label><input className="wb-input" value={reg} onChange={(e) => setReg(e.target.value.toUpperCase())} /></div>
            <div><label className="wb-label">Business</label><select className="wb-select" value={business} onChange={(e) => setBusiness(e.target.value)}>{BUSINESSES.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
            <div>
              <label className="wb-label">Vehicle model (for thermostat housing etc.)</label>
              <select className="wb-select" value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)}>
                <option value="">Not set</option>
                {VEHICLE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                <option value="Other">Other / not listed</option>
              </select>
            </div>
          </div>
          <div><label className="wb-label">Symptoms / notes</label><textarea className="wb-textarea" rows={3} value={symptoms} onChange={(e) => setSymptoms(e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div><label className="wb-label">Job type</label><select className="wb-select" value={jobTypeId} onChange={(e) => { setJobTypeId(e.target.value); setExtraJobTypeIds((prev) => prev.filter((x) => x !== e.target.value)); }}>{jobTypes.map((jt) => <option key={jt.id} value={jt.id}>{jt.name}</option>)}</select></div>
            <div><label className="wb-label">Booking date</label><input type="date" className="wb-input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><label className="wb-label">Days in for</label><input type="number" min="1" className="wb-input" value={days} onChange={(e) => setDays(Math.max(1, parseInt(e.target.value) || 1))} /></div>
          </div>
          <div>
            <label className="wb-label">Extra jobs (e.g. Turbo — a whole additional job type on top of the main one)</label>
            {extraJobTypeIds.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {extraJobTypeIds.map((id) => {
                  const jt = jobTypes.find((j) => j.id === id);
                  return (
                    <span key={id} className="wb-chip" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 0 }}>
                      {jt?.name || id}
                      <X size={11} style={{ cursor: "pointer" }} onClick={() => {
                        setExtraJobTypeIds((prev) => prev.filter((x) => x !== id));
                        setJobTypePrices((prev) => { const next = { ...prev }; delete next[id]; return next; });
                      }} />
                    </span>
                  );
                })}
              </div>
            )}
            <select
              className="wb-select" value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const id = e.target.value;
                setExtraJobTypeIds((prev) => [...prev, id]);
                setJobTypePrices((prev) => (id in prev ? prev : { ...prev, [id]: priceForNewJobType(id) }));
              }}
            >
              <option value="">+ add an extra job…</option>
              {jobTypes.filter((jt) => jt.id !== jobTypeId && !extraJobTypeIds.includes(jt.id)).map((jt) => <option key={jt.id} value={jt.id}>{jt.name}</option>)}
            </select>
          </div>
          {jobTypeBomLines.length > 0 && (
            <div>
              <label className="wb-label">Confirm quantities (adjust for parts that vary per vehicle, e.g. Followers)</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {jobTypeBomLines.map((l) => {
                  const qty = overrideQty(l.partId) ?? l.qty;
                  return (
                    <div key={l.partId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 13 }}>{partsIndex[l.partId] || l.partId}</span>
                      <input
                        type="number" step="0.1" min="0" className="wb-input" style={{ width: 70 }} value={qty}
                        onChange={(e) => setOverrideQty(l.partId, parseFloat(e.target.value) || 0, l.qty)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <label className="wb-label">Pricing</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {allJobTypeIds.map((id) => {
                const jtObj = jobTypes.find((j) => j.id === id);
                return (
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 13 }}>{jtObj?.name || id}</span>
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>£</span>
                    <input
                      type="number" className="wb-input" style={{ width: 100 }} value={jobTypePrices[id] || ""}
                      onChange={(e) => { const price = parseFloat(e.target.value) || 0; setJobTypePrices((prev) => ({ ...prev, [id]: price })); }}
                    />
                  </div>
                );
              })}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 13, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                <span>Total invoice</span>
                <span className="wh-mono">£{jobValue.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div>
            <label className="wb-label">Extra parts (single items straight from Stock, e.g. one extra gasket)</label>
            {extraParts.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                {extraParts.map((l) => (
                  <div key={l.partId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 13 }}>{partsIndex[l.partId] || l.partId}</span>
                    <input
                      type="number" step="0.1" className="wb-input" style={{ width: 70 }} value={l.qty}
                      onChange={(e) => { const qty = parseFloat(e.target.value) || 0; setExtraParts((prev) => prev.map((x) => (x.partId === l.partId ? { ...x, qty } : x))); }}
                    />
                    <X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setExtraParts((prev) => prev.filter((x) => x.partId !== l.partId))} />
                  </div>
                ))}
              </div>
            )}
            <select
              className="wb-select" value=""
              onChange={(e) => {
                if (e.target.value === "__thermostat__") {
                  const partId = THERMOSTAT_MODEL_MAP[vehicleModel];
                  if (!partId) { alert("Set the vehicle model above first, so the correct thermostat housing can be picked."); return; }
                  if (!extraParts.some((l) => l.partId === partId)) setExtraParts((prev) => [...prev, { partId, qty: 1 }]);
                  return;
                }
                if (e.target.value) setExtraParts((prev) => [...prev, { partId: e.target.value, qty: 1 }]);
              }}
            >
              <option value="">+ add an extra part…</option>
              <option value="__thermostat__">Thermostat Housing (auto-picked by vehicle model)</option>
              {parts.filter((p) => !extraParts.some((l) => l.partId === p.id) && p.id !== "p_thermostat_housing_a" && p.id !== "p_thermostat_housing_b").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            {isTCS ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, marginBottom: 4 }}><Truck size={13} /> Collection & return included, free of charge</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
                  Included within 150 miles.{" "}
                  {settings.collectionInfoUrl ? <a href={settings.collectionInfoUrl} target="_blank" rel="noreferrer" style={{ color: "var(--amber2)" }}>See how it works →</a> : <span>(add explainer URL in Settings)</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div><label className="wb-label">Customer postcode</label><input className="wb-input" value={postcode} onChange={(e) => handlePostcodeChange(e.target.value.toUpperCase())} placeholder="e.g. WA4 6NL" /></div>
                  <div><label className="wb-label">Est. distance (miles)</label><input type="number" className="wb-input" value={distanceMiles ?? ""} onChange={(e) => setDistanceMiles(e.target.value ? parseFloat(e.target.value) : null)} /></div>
                </div>
                <div style={{ marginTop: 10 }}><label className="wb-label">Full pickup address</label><input className="wb-input" value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} /></div>
                {withinFreeRadius === false && <div style={{ marginTop: 10, padding: 10, background: "#241512", border: "1px solid #4a2420", borderRadius: 6, fontSize: 11, color: "var(--red)" }}>~{distanceMiles} miles is outside the free radius — a paid collection quote will be needed.</div>}
              </div>
            ) : (
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}><input type="checkbox" checked={pickupRequired} onChange={(e) => setPickupRequired(e.target.checked)} /><MapPin size={13} /> Local drop-off / collection needed</label>
                {pickupRequired && <div style={{ marginTop: 10 }}><label className="wb-label">Address</label><input className="wb-input" value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} /></div>}
              </div>
            )}
          </div>
          {jobTypeId && (
            <div style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 6, padding: 10 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>This will use:</div>
              <div className="wh-mono" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>
                {fullBookingBom({ jobTypeId, extraJobTypeIds, extraParts, bomQtyOverrides }, jobTypes).map((l) => <span key={l.partId}>{l.qty}× {partsIndex[l.partId] || l.partId}</span>)}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: 16, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="wb-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="wb-btn" disabled={!canSave} style={!canSave ? { opacity: 0.5, cursor: "not-allowed" } : {}} onClick={() => onSave({
            customerName: customerName.trim(), phone: phone.trim(), email: email.trim(), reg: reg.trim(), symptoms: symptoms.trim(), business, jobTypeId, extraJobTypeIds, extraParts, bomQtyOverrides, date, days, vehicleModel,
            pickupRequired: isTCS ? true : pickupRequired, pickupAddress: pickupAddress.trim(), postcode: postcode.trim(),
            distanceMiles: typeof distanceMiles === "number" ? distanceMiles : null,
            jobValue,
            jobTypePrices: allJobTypeIds.map((id) => ({ jobTypeId: id, price: jobTypePrices[id] || 0 })),
            // Labour/transport stay calendar-tab-only for an existing booking — editing here must never clobber those.
            // Timing Chain Replacement gets its standard labour cost alongside the pricing breakdown above; everything else starts at zero.
            ...(booking ? {} : { labourCost: isTimingChainReplacement(jobTypes.find((j) => j.id === jobTypeId)) ? STANDARD_TIMING_CHAIN_PRICE.labourCost : 0, transportCost: 0 }),
          })}>{booking ? "Save changes" : "Save booking"}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// WORKSHOP MODE (iPad / technician)
// ============================================================
function WorkshopMode({ bookings, jobTypes, parts, settings, jobCards, upsertJobCard, updateJobCard, removeJobCard, updateBooking, jobApprovals, addJobApproval, removeJobApproval }) {
  const [openCardId, setOpenCardId] = useState(null);
  const openCard = jobCards.find((c) => c.id === openCardId);

  if (openCard) {
    const booking = bookings.find((b) => b.id === openCard.bookingId);
    return (
      <JobCardDetail
        card={openCard} booking={booking} jobTypes={jobTypes} parts={parts}
        onUpdate={(patch) => updateJobCard(openCard.id, patch)} onBack={() => setOpenCardId(null)} updateBooking={updateBooking}
        onDelete={() => { removeJobCard(openCard.id); setOpenCardId(null); }}
        jobApprovals={jobApprovals.filter((a) => a.jobCardId === openCard.id)}
        addJobApproval={(description) => addJobApproval(openCard.id, openCard.bookingId, description)}
        removeJobApproval={removeJobApproval}
      />
    );
  }

  return <WorkshopHome bookings={bookings} jobTypes={jobTypes} parts={parts} jobCards={jobCards} onOpenCard={setOpenCardId} onCreateCard={(card) => { upsertJobCard(card); setOpenCardId(card.id); }} />;
}

function WorkshopHome({ bookings, jobTypes, parts, jobCards, onOpenCard, onCreateCard }) {
  const [query, setQuery] = useState("");
  const partsIndex = useMemo(() => Object.fromEntries(parts.map((p) => [p.id, p.name])), [parts]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "");
    if (!q) return [];
    return bookings.filter((b) => (b.reg || "").toLowerCase().replace(/\s+/g, "").includes(q)).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [bookings, query]);

  const recentCards = jobCards.slice(0, 6);

  const pickUpJob = (booking) => {
    const existing = jobCards.find((c) => c.bookingId === booking.id);
    if (existing) { onOpenCard(existing.id); return; }
    onCreateCard(BLANK_CARD(booking));
  };

  return (
    <div style={{ padding: 20, maxWidth: 640, margin: "0 auto" }}>
      <div style={{ marginBottom: 18 }}>
        <label className="jc-label">Find a vehicle by registration</label>
        <div style={{ position: "relative" }}>
          <Search size={18} style={{ position: "absolute", left: 14, top: 17, color: "var(--muted)" }} />
          <input className="jc-input" style={{ paddingLeft: 42, fontSize: 18 }} placeholder="e.g. YH19 KLM" value={query} onChange={(e) => setQuery(e.target.value.toUpperCase())} autoFocus />
        </div>
      </div>

      {query && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
          {matches.length === 0 && <div style={{ color: "var(--muted)", fontSize: 14, textAlign: "center", padding: "20px 0" }}>No booking found for that registration.</div>}
          {matches.map((b) => {
            const jt = jobTypes.find((j) => j.id === b.jobTypeId);
            const existingCard = jobCards.find((c) => c.bookingId === b.id);
            return (
              <div key={b.id} className="jc-list-item" onClick={() => pickUpJob(b)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 18 }} className="wh-mono">{b.reg}</div>
                    <div style={{ fontSize: 14, marginTop: 2 }}>{b.customerName}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {existingCard?.locked && <span className="jc-chip locked"><Lock size={10} style={{ display: "inline", marginRight: 3 }} />signed</span>}
                    <span className={`jc-chip ${b.business === "Timing Chain Specialists" ? "tcs" : "w4"}`}>{b.business === "Timing Chain Specialists" ? "TCS" : "W4x4"}</span>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "var(--amber2)", marginTop: 6, fontWeight: 700 }}>{jt?.name || "No job type set"}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Booked for {fmtDate(b.date)}</div>
                {jt && (
                  <div className="wh-mono" style={{ fontSize: 12, marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
                    {jt.bom.map((l) => <span key={l.partId}>{l.qty}× {partsIndex[l.partId] || l.partId}</span>)}
                  </div>
                )}
                {b.symptoms && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, fontStyle: "italic" }}>"{b.symptoms}"</div>}
                <button className="jc-btn" style={{ width: "100%", justifyContent: "center", marginTop: 12 }}>{existingCard ? "Open job card" : "Start job card"}</button>
              </div>
            );
          })}
        </div>
      )}

      {!query && recentCards.length > 0 && (
        <div>
          <div className="jc-label" style={{ marginBottom: 10 }}>Recent job cards</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recentCards.map((c) => (
              <div key={c.id} className="jc-list-item" onClick={() => onOpenCard(c.id)}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 700 }} className="wh-mono">{c.reg || "No reg"}</div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>{c.customerName}</div>
                  </div>
                  {c.locked && <span className="jc-chip locked"><Lock size={10} style={{ display: "inline", marginRight: 3 }} />signed</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, disabled, placeholder }) {
  return <div><label className="jc-label">{label}</label><input className="jc-input" value={value || ""} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></div>;
}

function Toggle({ label, on, onClick, disabled }) {
  return (
    <div className={`jc-toggle ${on ? "on" : ""}`} onClick={disabled ? undefined : onClick} style={disabled ? { opacity: 0.6 } : {}}>
      <div style={{ width: 22, height: 22, borderRadius: 6, border: "2px solid currentColor", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{on && <Check size={14} />}</div>
      {label}
    </div>
  );
}

function DictateField({ label, value, onChange, rows = 4, disabled }) {
  // Tracks which language is currently listening (or null) rather than a
  // plain boolean, since both an English and an Albanian mic button share
  // this field and only one recognition session can run at a time.
  const [listeningLang, setListeningLang] = useState(null);
  const recogRef = useRef(null);
  const baseValueRef = useRef(value);
  const supported = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const toggleDictate = (lang) => {
    if (disabled) return;
    if (listeningLang) {
      recogRef.current?.stop();
      setListeningLang(null);
      if (listeningLang === lang) return; // was already dictating this language — just stop
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recog = new SR();
    recog.lang = lang; recog.continuous = true; recog.interimResults = true;
    baseValueRef.current = value ? value + " " : "";
    recog.onresult = (e) => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; onChange(baseValueRef.current + t); };
    recog.onerror = () => setListeningLang(null);
    recog.onend = () => setListeningLang(null);
    try { recog.start(); recogRef.current = recog; setListeningLang(lang); } catch (e) { setListeningLang(null); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        {label && <label className="jc-label" style={{ marginBottom: 0 }}>{label}</label>}
        {supported && !disabled && (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="jc-btn-sm" style={listeningLang === "en-GB" ? { background: "#3a1210", borderColor: "var(--red)", color: "var(--red)" } : {}} onClick={() => toggleDictate("en-GB")} type="button">
              {listeningLang === "en-GB" ? <MicOff size={14} /> : <Mic size={14} />} {listeningLang === "en-GB" ? "Stop" : "Dictate"}
            </button>
            <button className="jc-btn-sm" style={listeningLang === "sq-AL" ? { background: "#3a1210", borderColor: "var(--red)", color: "var(--red)" } : {}} onClick={() => toggleDictate("sq-AL")} type="button">
              {listeningLang === "sq-AL" ? <MicOff size={14} /> : <Mic size={14} />} {listeningLang === "sq-AL" ? "Stop" : "Dictate (Albanian)"}
            </button>
          </div>
        )}
      </div>
      <textarea className="jc-textarea" rows={rows} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder="Tap here, then use your keyboard's dictation button to speak this in…" style={disabled ? { opacity: 0.6 } : {}} />
    </div>
  );
}

// ---- Job breakdown (read-only, pulled live from the linked booking) ----
function JobBreakdown({ booking, jobTypes, parts }) {
  if (!booking) return null;
  const jt = jobTypes.find((j) => j.id === booking.jobTypeId);
  const extraJts = (booking.extraJobTypeIds || []).map((id) => jobTypes.find((j) => j.id === id)).filter(Boolean);
  const partsIndex = Object.fromEntries(parts.map((p) => [p.id, p]));
  const bom = fullBookingBom(booking, jobTypes);
  return (
    <div className="jc-card" style={{ background: "#1c1710", border: "1px solid #3a2d10" }}>
      <div className="jc-section-title" style={{ color: "var(--amber2)" }}><ListChecks size={16} /> What's needed — from the booking</div>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>
        {jt?.name || "No job type set"}{extraJts.length > 0 && ` + ${extraJts.map((e) => e.name).join(" + ")}`}
      </div>
      {booking.symptoms && <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10, fontStyle: "italic" }}>"{booking.symptoms}"</div>}
      {bom.length > 0 && (
        <div className="wh-mono" style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 3 }}>
          {bom.map((l) => {
            const p = partsIndex[l.partId];
            return <span key={l.partId}>{l.qty} {p?.unit} × {p?.name || l.partId}</span>;
          })}
        </div>
      )}
      {booking.business === "Timing Chain Specialists" && booking.postcode && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, borderTop: "1px solid #3a2d10", paddingTop: 8 }}>
          <Truck size={12} style={{ display: "inline", marginRight: 4 }} />Collection: {booking.postcode} (~{booking.distanceMiles ?? "?"} mi)
        </div>
      )}
    </div>
  );
}


// ---- Full job card detail ----
function JobCardDetail({ card, booking, jobTypes, parts, onUpdate, onBack, onDelete, updateBooking, jobApprovals, addJobApproval, removeJobApproval }) {
  const setField = (field, val) => onUpdate({ [field]: val });
  const setNested = (group, field, val) => onUpdate({ [group]: { ...card[group], [field]: val } });
  const [newExtraWork, setNewExtraWork] = useState("");
  const [writeupState, setWriteupState] = useState({ generating: false, pdfUrl: null, error: null });

  const generateTechnicalWriteup = async () => {
    setWriteupState({ generating: true, pdfUrl: null, error: null });
    try {
      const res = await fetch("/api/office/technical-writeup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobCardId: card.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate the write-up");
      setWriteupState({ generating: false, pdfUrl: data.pdfUrl, error: null });
    } catch (e) {
      setWriteupState({ generating: false, pdfUrl: null, error: e.message || "Failed to generate the write-up" });
    }
  };

  return (
    <div>
      <div className="wh-topbar" style={{ position: "static", justifyContent: "space-between" }}>
        <button className="jc-btn-ghost" onClick={onBack}><ArrowLeft size={16} /> Back to search</button>
        <button
          className="jc-btn-ghost"
          style={{ color: "var(--red)" }}
          onClick={() => { if (confirm(`Delete this job card for ${card.customerName || card.reg || "this customer"}? This can't be undone — use this for cancelled customers only.`)) onDelete(); }}
        >
          <Trash2 size={16} /> Delete job card
        </button>
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, maxWidth: 760, margin: "0 auto" }}>
        <JobBreakdown booking={booking} jobTypes={jobTypes} parts={parts} />

        {booking && (
          <div className="jc-card">
            <div className="jc-section-title">Job progress</div>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {booking.completed ? "Collected" : booking.workshopCompleted ? "Workshop completed — awaiting collection" : booking.arrived ? "Arrived — in progress" : "Not yet arrived"}
              </span>
            </div>
            <TrafficLightButtons booking={booking} updateBooking={updateBooking} showCollected={false} />
          </div>
        )}

        <div className="jc-card">
          <div className="jc-section-title">Extra work found</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            Describe anything found beyond the original job — no price needed here, office will set that and send it on to the customer for approval.
          </div>
          {jobApprovals && jobApprovals.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {jobApprovals.map((a) => {
                const statusLabel = { draft: "Waiting on office", sent: "Sent — awaiting customer", approved: "Approved", declined: "Declined" }[a.status];
                const statusColor = { draft: "var(--muted)", sent: "#ffb84d", approved: "var(--green)", declined: "var(--red)" }[a.status];
                return (
                  <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, background: "var(--panel2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, textTransform: "uppercase", letterSpacing: "0.04em" }}>{statusLabel}</span>
                      {a.status === "draft" && (
                        <button onClick={() => removeJobApproval(a.id)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={13} /></button>
                      )}
                    </div>
                    <div style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{a.description}</div>
                  </div>
                );
              })}
            </div>
          )}
          <DictateField label="What did you find?" value={newExtraWork} onChange={setNewExtraWork} rows={4} />
          <button
            className="jc-btn-sm"
            style={{ marginTop: 10 }}
            disabled={!newExtraWork.trim()}
            onClick={() => { addJobApproval(newExtraWork.trim()); setNewExtraWork(""); }}
          >
            <AlertTriangle size={14} /> Flag for office approval
          </button>
        </div>

        <div className="jc-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 20 }} className="wh-mono">{card.reg || "No reg"}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div><label className="jc-label">Date in</label><input type="date" className="jc-input" value={card.dateIn} onChange={(e) => setField("dateIn", e.target.value)} /></div>
            <div><label className="jc-label">Date out</label><input type="date" className="jc-input" value={card.dateOut} onChange={(e) => setField("dateOut", e.target.value)} /></div>
            <div><label className="jc-label">Technician</label><input className="jc-input" value={card.technician} onChange={(e) => setField("technician", e.target.value)} /></div>
          </div>
        </div>

        <div className="jc-card">
          <div className="jc-section-title"><Car size={16} /> Vehicle details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Make" value={card.make} onChange={(v) => setField("make", v)} />
            <Field label="Model" value={card.model} onChange={(v) => setField("model", v)} />
            <Field label="Registration" value={card.reg} onChange={(v) => setField("reg", v.toUpperCase())} />
            <Field label="Mileage in" value={card.mileageIn} onChange={(v) => setField("mileageIn", v)} />
            <Field label="Mileage out" value={card.mileageOut} onChange={(v) => setField("mileageOut", v)} />
          </div>
        </div>

        <div className="jc-card">
          <div className="jc-section-title"><User size={16} /> Customer details</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Name" value={card.customerName} onChange={(v) => setField("customerName", v)} />
            <Field label="Contact" value={card.contact} onChange={(v) => setField("contact", v)} />
          </div>
        </div>

        <div className="jc-card">
          <div className="jc-section-title">Job status</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>The original job was already authorised at booking — this is only for extra work found and approved after drop-off.</div>
          <Toggle label="Customer authorised additional work" on={card.jobStatus.customerAuthReceived} onClick={() => setNested("jobStatus", "customerAuthReceived", !card.jobStatus.customerAuthReceived)} />
          <div style={{ marginTop: 12 }}><DictateField label="Auth ref / notes" value={card.authRefNotes} onChange={(v) => setField("authRefNotes", v)} rows={2} /></div>
        </div>

        <div className="jc-card"><div className="jc-section-title">Customer symptoms</div><DictateField value={card.symptoms} onChange={(v) => setField("symptoms", v)} rows={5} /></div>
        <div className="jc-card"><div className="jc-section-title">Technician interpretation</div><DictateField value={card.technicianInterpretation} onChange={(v) => setField("technicianInterpretation", v)} rows={5} /></div>

        <div className="jc-card">
          <div className="jc-section-title">Pre-diagnostic checks</div>
          <Toggle label="Pre scan completed & emailed" on={card.preDiagnostic.preScanCompleted} onClick={() => setNested("preDiagnostic", "preScanCompleted", !card.preDiagnostic.preScanCompleted)} />
        </div>

        <div className="jc-card"><div className="jc-section-title">Diagnosis & findings</div><DictateField value={card.diagnosisFindings} onChange={(v) => setField("diagnosisFindings", v)} rows={6} /></div>

        <div className="jc-card">
          <div className="jc-section-title">Technical write-up (warranty / legal)</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            AI-tightened version of the technician interpretation and diagnosis findings above — keeps the technical detail, doesn't simplify anything. Saved as a PDF to the shared Drive folder.
          </div>
          <button className="jc-btn-sm" disabled={writeupState.generating} onClick={generateTechnicalWriteup}>
            <FileText size={14} /> {writeupState.generating ? "Generating…" : "Generate technical write-up (PDF)"}
          </button>
          {writeupState.pdfUrl && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <a href={writeupState.pdfUrl} target="_blank" rel="noreferrer" style={{ color: "var(--amber)" }}>Open the generated PDF</a>
            </div>
          )}
          {writeupState.error && <div style={{ marginTop: 10, fontSize: 12, color: "var(--red)" }}>{writeupState.error}</div>}
        </div>

        <div className="jc-card">
          <div className="jc-section-title">Post-repair checks</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Toggle label="Post scan completed" on={card.postDiagnostic.postScanCompleted} onClick={() => setNested("postDiagnostic", "postScanCompleted", !card.postDiagnostic.postScanCompleted)} />
            <Toggle label="Road test completed" on={card.postChecks.roadTestCompleted} onClick={() => setNested("postChecks", "roadTestCompleted", !card.postChecks.roadTestCompleted)} />
          </div>
        </div>
      </div>
    </div>
  );
}
