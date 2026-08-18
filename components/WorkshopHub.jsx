"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar, Plus, ClipboardPaste, Package, Wrench, AlertTriangle, X, ChevronLeft, ChevronRight, ChevronDown,
  MapPin, Phone, Car, FileText, Truck, Settings as SettingsIcon, ListChecks, Check, TrendingDown, TrendingUp,
  Mail, PoundSterling, Search, ArrowLeft, Mic, MicOff, PenLine, RotateCcw, Lock, Languages,
  User, Building2, LayoutGrid, LogOut, Inbox, ThumbsDown, MessageCircle, History, Minus, List, Trash2, Printer, Sun, Star, Download,
} from "lucide-react";
import {
  fetchAll, fetchParts, fetchJobTypes, fetchBookings, fetchJobCards, fetchJobApprovals, fetchSettings, fetchPriceHistory, fetchStockBatches, fetchBrands, fetchHolidays, fetchBonusRates, fetchStaffWages, fetchFixedCosts, fetchAuditLog, insertAuditLog,
  insertPart, updatePart, deletePart, insertJobType, renameJobType, updateJobTypeColor, updateJobTypeBrand, updateJobTypeStandardPrice, updateJobTypePublicBookable, deleteJobType, insertBrand, deleteBrand, renameBrand, addBomLine, updateBomLine, removeBomLine,
  insertHoliday, deleteHoliday,
  insertBonusRate, updateBonusRate, updateBonusRateJobTypes, deleteBonusRate, upsertStaffWage, deleteStaffWage,
  insertFixedCost, updateFixedCost, deleteFixedCost,
  saveSettings, insertBooking, updateBookingRow, deleteBookingRow, addBookingJobType, removeBookingJobType,
  setBookingExtraPart, removeBookingExtraPart, setBookingJobTypePrice, removeBookingJobTypePrice, setBookingBomQtyOverride, removeBookingBomQtyOverride,
  upsertJobCardRow, updateJobCardRow, deleteJobCardRow,
  insertPriceHistory, deletePriceHistory, updatePriceHistorySupplier, insertStockBatch, updateStockBatchQtyRemaining, markStockBatchDelivered, deleteStockBatch, updateStockBatchSupplier, updateStockBatch,
  insertJobApproval, updateJobApprovalRow, deleteJobApproval,
  fetchSuppliers, insertSupplier, updateSupplier, deleteSupplier,
  fetchSupplierInvoices, updateSupplierInvoice, deleteSupplierInvoice,
  subscribeTable,
} from "@/lib/data";
import { CALENDAR_COLORS } from "@/lib/calendarColors";
import { BUSINESSES, REVIEW_LINKS } from "@/lib/constants";
import * as XLSX from "xlsx";
import { BookingShareActions } from "./BookingShareActions";
import { SupplierInvoicesTab } from "./SupplierInvoicesTab";

// ============================================================
// Shared constants & helpers
// ============================================================
const REORDER_WEEKS = 1;

// Which thermostat housing a model takes — lets the booking form pick the
// right stock part automatically instead of staff having to remember which
// of the two look-alike parts fits which model. Keyed on the Model field
// alone (not "Make Model") so it still matches once Make became its own
// dropdown driven by the brands list — Land Rover's brand entry is spelled
// "Landrover" there, which would never match a "Land Rover ..." string.
const THERMOSTAT_MODEL_MAP = {
  "Range Rover Evoque": "p_thermostat_housing_a",
  "Discovery Sport": "p_thermostat_housing_a",
  "E-Pace": "p_thermostat_housing_a",
  "Range Rover Velar": "p_thermostat_housing_b",
  "F-Pace": "p_thermostat_housing_b",
  "XE": "p_thermostat_housing_b",
  "XF": "p_thermostat_housing_b",
  "Discovery 5": "p_thermostat_housing_b",
};
const VEHICLE_MODELS = Object.keys(THERMOSTAT_MODEL_MAP);
const PAYMENT_METHODS = ["Cash", "Debit Card", "Bank Transfer", "Payment Assist"];
const uid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
// Forces a real reason before a stock correction or order change goes
// through — an empty answer just re-prompts rather than being accepted as
// blank, and cancelling out of the prompt aborts the whole action (so the
// change never happens without a reason logged, not just skips the log).
const promptReason = (question) => {
  let reason = window.prompt(question);
  while (reason !== null && !reason.trim()) reason = window.prompt(`${question}\n(An answer is required — Cancel instead if you don't want to make this change.)`);
  return reason === null ? null : reason.trim();
};
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
// Weekdays only between two dates inclusive — a holiday spanning a weekend
// shouldn't count those two days, since nobody's rostered to work them
// anyway. Same UTC-throughout approach as addDaysISO above, for the same
// DST-safety reason.
const weekdayCount = (dateFrom, dateTo) => {
  const [fy, fm, fd] = dateFrom.split("-").map(Number);
  const [ty, tm, td] = dateTo.split("-").map(Number);
  let count = 0;
  for (let t = Date.UTC(fy, fm - 1, fd), end = Date.UTC(ty, tm - 1, td); t <= end; t += 86400000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
};
// Per-staff holiday colour, keyed by first name (case-insensitive) so the
// calendar star and Holidays tab agree on who's who at a glance.
const STAFF_HOLIDAY_COLORS = { ervin: "var(--red)", ernesto: "var(--blue)", chris: "var(--green)" };
const holidayColor = (name) => STAFF_HOLIDAY_COLORS[(name || "").trim().toLowerCase()] || "var(--amber)";

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

I can confirm your vehicle${b.reg ? ` (${b.reg})` : ""} is booked in on ${fmtDate(b.date)} for approximately ${b.days || 1} day(s) — that's just an estimate, and we'll keep you updated throughout.

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
// Digits only, and drops a leading "44" (with or without a "+") down to the
// "0" a UK number would normally start with, so "+44 7911 123456" and
// "07911123456" match the same booking.
function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("44")) digits = "0" + digits.slice(2);
  return digits;
}
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
  monthlyTarget: 40000,
  nonProductivesCost: 5000,
  workingDaysPerMonth: 25,
};

// Standard pricing for a Timing Chain Replacement — pre-filled on new
// bookings of this job type, and offered as a one-click fix for existing
// bookings of this type that were never priced.
const STANDARD_TIMING_CHAIN_PRICE = { jobValue: 1495, labourCost: 220 };
const isTimingChainReplacement = (jt) => jt?.name === "Timing Chain Replacement";

// Staff wages — basic monthly salary equates to a 40hr week, plus flat
// rates for weekend work on top (bonus rates are configurable per job
// type via the Bonus rates list instead, since that list needs to grow).
const DEFAULT_BASIC_WAGE = 2063;
const WEEKEND_FULL_DAY_RATE = 150;
const WEEKEND_HALF_DAY_RATE = 75;

// "Days in for" defaults per the shop's own standard turnaround for a few
// well-known job types — saves re-typing it (and mistyping it) on every
// booking. Brand-driven rather than matched on job type name alone, since
// names are free text staff can phrase however they like; only falls back
// to a name check where brand alone would be too broad (e.g. every Ford
// job isn't a 2-day wet belt). Returns null (no default) for anything else,
// so an unmatched job type just leaves "Days in for" as whatever it was.
function defaultDaysForJobType(jt, brands) {
  if (!jt) return null;
  const brandName = brands.find((b) => b.id === jt.brandId)?.name || "";
  const name = (jt.name || "").toLowerCase();
  if ((brandName === "Landrover" || brandName === "Jaguar" || brandName === "JLR") && name.includes("timing chain")) return 3;
  if (brandName === "Ford" && name.includes("wet belt") && (name.includes("transit") || name.includes("ranger"))) return 3;
  if (brandName === "Ford" && name.includes("wet belt")) return 2;
  if (brandName === "Nissan") return 2;
  if (brandName === "Peugeot" && (name.includes("pure tech") || name.includes("wetbelt") || name.includes("wet belt"))) return 2;
  if (brandName === "Vauxhall") return 2;
  if (brandName === "VAG") return 2;
  if (brandName === "Renault") return 2;
  return null;
}

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
    requiredBy: "",
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
  const [brands, setBrands] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [bonusRates, setBonusRates] = useState([]);
  const [staffWages, setStaffWages] = useState([]);
  const [fixedCosts, setFixedCosts] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierInvoices, setSupplierInvoices] = useState([]);
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
        setBrands(d.brands);
        setHolidays(d.holidays);
        setBonusRates(d.bonusRates);
        setStaffWages(d.staffWages);
        setFixedCosts(d.fixedCosts);
        setAuditLog(d.auditLog);
      } catch (e) {
        console.error("Failed to load Workshop Hub data", e);
      }
      // Fetched separately from the bundle above — these two tables are the
      // newest in the schema, so isolating them means a not-yet-run
      // migration only leaves the Supplier Invoices tab empty instead of
      // taking down every other table's initial load with it.
      try {
        setSuppliers(await fetchSuppliers());
        setSupplierInvoices(await fetchSupplierInvoices());
      } catch (e) {
        console.error("Failed to load supplier invoice data", e);
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
      subscribeTable("brands", async () => setBrands(await fetchBrands())),
      subscribeTable("holidays", async () => setHolidays(await fetchHolidays())),
      subscribeTable("bonus_rates", async () => setBonusRates(await fetchBonusRates())),
      subscribeTable("staff_wages", async () => setStaffWages(await fetchStaffWages())),
      subscribeTable("fixed_costs", async () => setFixedCosts(await fetchFixedCosts())),
      subscribeTable("audit_log", async () => setAuditLog(await fetchAuditLog())),
      subscribeTable("settings", async () => { const s = await fetchSettings(); if (s) setSettings({ ...DEFAULT_SETTINGS, ...s }); }),
      subscribeTable("suppliers", async () => setSuppliers(await fetchSuppliers())),
      subscribeTable("supplier_invoices", async () => setSupplierInvoices(await fetchSupplierInvoices())),
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

  // What's already spoken for by jobs that are booked in but not yet
  // workshop completed — stock isn't actually deducted until completion
  // (see addBooking/updateBooking below), so physical stock alone can look
  // fine while every unit of it is already earmarked for work that's
  // already on the diary. This is what actually answers "do I have enough
  // for what I've already booked in", separate from the historical
  // usage-rate reorder alert above.
  const partCommittedToUpcoming = useMemo(() => {
    const committed = {};
    bookings.forEach((b) => {
      // A collected booking is done regardless of whether workshopCompleted
      // ever got ticked on the way there — some older/imported bookings went
      // straight to completed without it, and counting those as still-
      // pending demand would double-count parts that were already used.
      if (b.workshopCompleted || b.completed) return;
      fullBookingBom(b, jobTypes).forEach((l) => { committed[l.partId] = (committed[l.partId] || 0) + l.qty; });
    });
    return committed;
  }, [bookings, jobTypes]);

  // Stock already ordered from a supplier but not yet delivered — still
  // counts toward covering upcoming bookings even though it's not
  // physically here yet, so it shouldn't be left out of "remaining".
  const partOnOrder = useMemo(() => {
    const onOrder = {};
    stockBatches.filter((b) => b.status === "ordered").forEach((b) => { onOrder[b.partId] = (onOrder[b.partId] || 0) + b.qtyRemaining; });
    return onOrder;
  }, [stockBatches]);

  const stockRows = useMemo(() => parts.map((p) => {
    const weekly = partUsageWeekly[p.id] || 0;
    const weeksLeft = weekly > 0 ? p.stock / weekly : Infinity;
    const committed = partCommittedToUpcoming[p.id] || 0;
    const onOrder = partOnOrder[p.id] || 0;
    return { ...p, weekly, weeksLeft, needsOrder: weeksLeft < REORDER_WEEKS, committed, onOrder, availableAfterUpcoming: p.stock + onOrder - committed };
  }), [parts, partUsageWeekly, partCommittedToUpcoming, partOnOrder]);
  const lowStockItems = stockRows.filter((r) => r.needsOrder);

  // Walks every not-yet-completed booking in date order, running down each
  // part's available stock (physical + on order) as demand comes due, to
  // find the first booking whose parts won't be covered by what's in hand —
  // i.e. the actual date by which more needs to be ordered, rather than just
  // "is it low right now" (stockRows/lowStockItems above are a snapshot, not
  // a timeline). Only the earliest shortfall per part is kept — once it's
  // flagged there, ordering more fixes every booking after it too.
  const partsForecastShortfalls = useMemo(() => {
    const available = {};
    parts.forEach((p) => { available[p.id] = p.stock + (partOnOrder[p.id] || 0); });
    const upcoming = bookings
      .filter((b) => !b.workshopCompleted && !b.completed && b.date)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const shortfalls = {};
    upcoming.forEach((b) => {
      fullBookingBom(b, jobTypes).forEach((l) => {
        if (!(l.partId in available)) return;
        available[l.partId] -= l.qty;
        if (available[l.partId] < 0 && !shortfalls[l.partId]) {
          const part = parts.find((p) => p.id === l.partId);
          shortfalls[l.partId] = {
            partId: l.partId,
            partName: part?.name || l.partId,
            shortBy: -available[l.partId],
            date: b.date,
            bookingId: b.id,
            customerName: b.customerName,
          };
        }
      });
    });
    return Object.values(shortfalls).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [bookings, jobTypes, parts, partOnOrder]);

  // Shown once per calendar day (not per session, unlike the reorder alert
  // above) — a fresh check each morning of what the diary now needs, without
  // nagging again every time someone flips between Office and Workshop mode.
  const [forecastShownDate, setForecastShownDate] = useState(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("wb-parts-forecast-shown-date");
  });
  const [showForecastAlert, setShowForecastAlert] = useState(false);
  useEffect(() => {
    if (partsForecastShortfalls.length > 0 && forecastShownDate !== todayISO()) {
      setShowForecastAlert(true);
    }
  }, [partsForecastShortfalls.map((s) => `${s.partId}:${s.date}`).join(","), forecastShownDate]);
  const dismissForecastAlert = () => {
    const today = todayISO();
    localStorage.setItem("wb-parts-forecast-shown-date", today);
    setForecastShownDate(today);
    setShowForecastAlert(false);
  };

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

  // A supplier confirms an order then cancels it at the last minute often
  // enough that this needs to be a one-click undo — the order never
  // physically arrived, so there's no stock or FIFO price queue to unwind,
  // just the pending batch record itself.
  const cancelOrder = (batchId) => withSaveState(async () => {
    setStockBatches((prev) => prev.filter((b) => b.id !== batchId));
    await deleteStockBatch(batchId);
  });

  // Corrects a pending order still awaiting delivery — wrong qty/price typed
  // in, supplier came back with a different price, or there genuinely wasn't
  // enough in stock to justify the original quantity. Only touches orders
  // that haven't been delivered yet (see updateStockBatch in lib/data).
  const amendOrder = (batchId, fields) => withSaveState(async () => {
    setStockBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, ...(fields.qty !== undefined ? { qtyOrdered: fields.qty, qtyRemaining: fields.qty } : {}), ...(fields.price !== undefined ? { price: fields.price } : {}), ...(fields.supplier !== undefined ? { supplier: fields.supplier } : {}), ...(fields.dueDate !== undefined ? { dueDate: fields.dueDate } : {}) } : b)));
    await updateStockBatch(batchId, fields);
  });

  const addAuditLog = (summary, reason) => withSaveState(async () => {
    const entry = { id: uid("al"), summary, reason, createdAt: new Date().toISOString() };
    setAuditLog((prev) => [entry, ...prev]);
    await insertAuditLog(entry);
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

  const addJobTypeFn = (name, brandId) => withSaveState(async () => {
    const jobType = { id: uid("jt"), name, bom: [], brandId: brandId || null };
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

  const updateJobTypeBrandFn = (jtId, brandId) => withSaveState(async () => {
    setJobTypes((prev) => prev.map((j) => (j.id === jtId ? { ...j, brandId } : j)));
    await updateJobTypeBrand(jtId, brandId);
  });

  const updateJobTypeStandardPriceFn = (jtId, price) => withSaveState(async () => {
    setJobTypes((prev) => prev.map((j) => (j.id === jtId ? { ...j, standardPrice: price } : j)));
    await updateJobTypeStandardPrice(jtId, price);
  });

  const updateJobTypePublicBookableFn = (jtId, publicBookable) => withSaveState(async () => {
    setJobTypes((prev) => prev.map((j) => (j.id === jtId ? { ...j, publicBookable } : j)));
    await updateJobTypePublicBookable(jtId, publicBookable);
  });

  const removeJobTypeFn = (jtId) => withSaveState(async () => {
    setJobTypes((prev) => prev.filter((j) => j.id !== jtId));
    await deleteJobType(jtId);
  });

  const addBrandFn = (name) => withSaveState(async () => {
    const brand = { id: uid("brand"), name };
    setBrands((prev) => [...prev, brand]);
    await insertBrand(brand);
  });

  const removeBrandFn = (brandId) => withSaveState(async () => {
    setBrands((prev) => prev.filter((b) => b.id !== brandId));
    // DB has job_types.brand_id on delete set null, so this mirrors that
    // locally rather than waiting on a realtime refetch to catch up.
    setJobTypes((prev) => prev.map((j) => (j.brandId === brandId ? { ...j, brandId: null } : j)));
    await deleteBrand(brandId);
  });

  const renameBrandFn = (brandId, name) => withSaveState(async () => {
    setBrands((prev) => prev.map((b) => (b.id === brandId ? { ...b, name } : b)));
    await renameBrand(brandId, name);
  });

  const addSupplierFn = (name, contactEmail, contactName) => withSaveState(async () => {
    const supplier = { id: uid("sup"), name, contactEmail, contactName };
    setSuppliers((prev) => [...prev, supplier]);
    await insertSupplier(supplier);
  });

  const updateSupplierFn = (id, patch) => withSaveState(async () => {
    setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    await updateSupplier(id, patch);
  });

  const removeSupplierFn = (id) => withSaveState(async () => {
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
    await deleteSupplier(id);
  });

  const updateSupplierInvoiceFn = (id, patch) => withSaveState(async () => {
    setSupplierInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    await updateSupplierInvoice(id, patch);
  });

  const removeSupplierInvoiceFn = (id) => withSaveState(async () => {
    setSupplierInvoices((prev) => prev.filter((i) => i.id !== id));
    await deleteSupplierInvoice(id);
  });

  const addHolidayFn = (name, dateFrom, dateTo) => withSaveState(async () => {
    const holiday = { id: uid("hol"), name, dateFrom, dateTo };
    setHolidays((prev) => [...prev, holiday]);
    await insertHoliday(holiday);
  });

  const removeHolidayFn = (holidayId) => withSaveState(async () => {
    setHolidays((prev) => prev.filter((h) => h.id !== holidayId));
    await deleteHoliday(holidayId);
  });

  const addBonusRateFn = (name, rate, jobTypeIds = []) => withSaveState(async () => {
    const br = { id: uid("br"), name, rate, jobTypeIds };
    setBonusRates((prev) => [...prev, br]);
    await insertBonusRate(br);
  });

  const updateBonusRateFn = (id, rate) => withSaveState(async () => {
    setBonusRates((prev) => prev.map((b) => (b.id === id ? { ...b, rate } : b)));
    await updateBonusRate(id, rate);
  });

  const updateBonusRateJobTypesFn = (id, jobTypeIds) => withSaveState(async () => {
    setBonusRates((prev) => prev.map((b) => (b.id === id ? { ...b, jobTypeIds } : b)));
    await updateBonusRateJobTypes(id, jobTypeIds);
  });

  const removeBonusRateFn = (id) => withSaveState(async () => {
    setBonusRates((prev) => prev.filter((b) => b.id !== id));
    await deleteBonusRate(id);
  });

  // Callers always pass the row's existing id when editing (so this is a
  // true update, not a duplicate) and a freshly generated one only when
  // adding a new person for a month — see StaffWagesSection.
  const upsertStaffWageFn = (wage) => withSaveState(async () => {
    setStaffWages((prev) => (prev.some((w) => w.id === wage.id) ? prev.map((w) => (w.id === wage.id ? wage : w)) : [...prev, wage]));
    await upsertStaffWage(wage);
  });

  const removeStaffWageFn = (id) => withSaveState(async () => {
    setStaffWages((prev) => prev.filter((w) => w.id !== id));
    await deleteStaffWage(id);
  });

  // Corrects a supplier name once it's actually known, on either a delivered
  // purchase (part_price_history) or a still-pending order (stock_batches) —
  // Suppliers tab passes the right one of these depending on the row's kind.
  const updatePriceHistorySupplierFn = (id, supplier) => withSaveState(async () => {
    setPriceHistory((prev) => prev.map((h) => (h.id === id ? { ...h, supplier } : h)));
    await updatePriceHistorySupplier(id, supplier);
  });

  const updateStockBatchSupplierFn = (id, supplier) => withSaveState(async () => {
    setStockBatches((prev) => prev.map((b) => (b.id === id ? { ...b, supplier } : b)));
    await updateStockBatchSupplier(id, supplier);
  });

  const addFixedCostFn = (name, amount) => withSaveState(async () => {
    const fc = { id: uid("fc"), name, amount };
    setFixedCosts((prev) => [...prev, fc]);
    await insertFixedCost(fc);
  });

  const updateFixedCostFn = (id, fields) => withSaveState(async () => {
    setFixedCosts((prev) => prev.map((f) => (f.id === id ? { ...f, ...fields } : f)));
    await updateFixedCost(id, fields);
  });

  const removeFixedCostFn = (id) => withSaveState(async () => {
    setFixedCosts((prev) => prev.filter((f) => f.id !== id));
    await deleteFixedCost(id);
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
    <div style={{ "--bg": "#16181a", "--panel": "#1e2124", "--panel2": "#25292c", "--line": "#33383c", "--text": "#e7e3da", "--muted": "#9aa0a6", "--amber": "#f5a623", "--amber2": "#ffcf6b", "--red": "#e2574c", "--green": "#5fb87a", "--blue": "#4a90e2" }} className="wh-root">
      <style>{`
        .wh-root { background: var(--bg); color: var(--text); font-family: var(--font-inter), 'Inter', ui-sans-serif, system-ui, sans-serif; min-height: 100vh; -webkit-tap-highlight-color: transparent; }
        .wh-mono { font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
        .wh-topbar { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid var(--line); position:sticky; top:0; background:#16181a; z-index:20; }
        .wh-title { font-weight:800; font-size:17px; display:flex; align-items:center; gap:8px; }
        .wh-modeswitch { display:flex; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
        .wh-modebtn { padding:10px 16px; font-size:13px; font-weight:700; background:var(--panel); color:var(--muted); cursor:pointer; display:flex; align-items:center; gap:6px; border:none; }
        .wh-modebtn.active { background: var(--amber); color:#1a1508; }
        .wb-callerbox { padding:14px 18px 0; }
        .wb-callerdropdown { position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:60; padding:8px; max-height:360px; overflow-y:auto; }
        .wb-callerresult { padding:8px; border-radius:8px; cursor:pointer; }
        .wb-callerresult:hover { background: var(--panel2); }
        .wb-callerresult + .wb-callerresult { border-top:1px solid var(--line); margin-top:2px; padding-top:10px; }
        .wb-callerlink { font-size:12px; color:var(--amber2); text-decoration:none; padding:6px 4px; border-radius:6px; }
        .wb-callerlink:hover { background: var(--panel2); }
        .wb-tabs { display:flex; flex-wrap:wrap; gap:2px 1px; padding:8px 8px 0; border-bottom:1px solid var(--line); }
        .wb-tab { padding:7px 8px; font-size:11.5px; font-weight:600; color:var(--muted); border-bottom:2px solid transparent; cursor:pointer; display:flex; align-items:center; gap:3px; white-space:nowrap; }
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
        .wb-day { min-height:78px; min-width:0; overflow:hidden; border:1px solid var(--line); padding:6px; cursor:pointer; }
        .wb-day:hover { background: var(--panel2); }
        .wb-day.selected { border-color: var(--amber); box-shadow: inset 0 0 0 1px var(--amber); }
        .wb-day.today .wb-daynum { color: var(--amber2); }
        .wb-daynum { font-size:11px; color:var(--muted); font-weight:600; }
        .wb-chip, .jc-chip { font-size:10px; background:#2b2410; color:var(--amber2); border-radius:3px; padding:1px 5px; margin-top:3px; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .wb-day-dots { display:none; flex-wrap:wrap; gap:2px; margin-top:4px; }
        .wb-day-dot { width:6px; height:6px; border-radius:50%; background:var(--amber2); flex-shrink:0; }
        .wb-day-more { font-size:8px; color:var(--muted); }
        @media (max-width: 600px) {
          .wb-day { padding:3px 2px; min-height:40px; }
          .wb-day .wb-chip { display:none; }
          .wb-day .wb-day-dots { display:flex; }
          .wb-daynum { font-size:10px; }
        }
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
        .print-job-cards { display: none; }
        .print-still-to-finish { display: none; }
        .print-outstanding-parts { display: none; }
        @media print {
          body * { visibility: hidden; }
          .print-job-card, .print-job-card *,
          .print-job-cards, .print-job-cards *,
          .print-still-to-finish, .print-still-to-finish *,
          .print-outstanding-parts, .print-outstanding-parts * { visibility: visible; }
          .print-job-card { display: block; position: absolute; top: 0; left: 0; width: 100%; }
          .print-job-cards { display: block; position: absolute; top: 0; left: 0; width: 100%; }
          .print-still-to-finish { display: block; position: absolute; top: 0; left: 0; width: 100%; }
          .print-outstanding-parts { display: block; position: absolute; top: 0; left: 0; width: 100%; }
          .print-job-card-page { page-break-inside: avoid; break-inside: avoid; }
          .print-job-card-page { page-break-after: always; break-after: page; }
          .print-job-card-page:last-child { page-break-after: auto; break-after: auto; }
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
          brands={brands} addBrand={addBrandFn} removeBrand={removeBrandFn} renameBrand={renameBrandFn} updateJobTypeBrand={updateJobTypeBrandFn} removeJobType={removeJobTypeFn}
          updateJobTypeStandardPrice={updateJobTypeStandardPriceFn}
          updateJobTypePublicBookable={updateJobTypePublicBookableFn}
          holidays={holidays} addHoliday={addHolidayFn} removeHoliday={removeHolidayFn}
          bonusRates={bonusRates} addBonusRate={addBonusRateFn} updateBonusRate={updateBonusRateFn} updateBonusRateJobTypes={updateBonusRateJobTypesFn} removeBonusRate={removeBonusRateFn}
          staffWages={staffWages} upsertStaffWage={upsertStaffWageFn} removeStaffWage={removeStaffWageFn}
          fixedCosts={fixedCosts} addFixedCost={addFixedCostFn} updateFixedCost={updateFixedCostFn} removeFixedCost={removeFixedCostFn}
          bookings={bookings} addBooking={addBooking} removeBooking={removeBooking} updateBooking={updateBooking}
          settings={settings} updateSettingsField={updateSettingsField}
          stockRows={stockRows} lowStockItems={lowStockItems} receiveStock={receiveStock}
          stockBatches={stockBatches} orderStock={orderStock} deliverStock={deliverStock} cancelOrder={cancelOrder} amendOrder={amendOrder}
          priceHistory={priceHistory} recordPrice={recordPrice}
          updatePriceHistorySupplier={updatePriceHistorySupplierFn} updateStockBatchSupplier={updateStockBatchSupplierFn}
          auditLog={auditLog} addAuditLog={addAuditLog}
          pendingReorder={pendingReorder} showReorderAlert={showReorderAlert}
          setShowReorderAlert={setShowReorderAlert} setDismissedReorderIds={setDismissedReorderIds}
          partsForecastShortfalls={partsForecastShortfalls} showForecastAlert={showForecastAlert} dismissForecastAlert={dismissForecastAlert}
          jobCards={jobCards} jobApprovals={jobApprovals} updateJobApproval={updateJobApproval} removeJobApproval={removeJobApproval}
          suppliers={suppliers} addSupplier={addSupplierFn} updateSupplierField={updateSupplierFn} removeSupplier={removeSupplierFn}
          supplierInvoices={supplierInvoices} updateSupplierInvoiceField={updateSupplierInvoiceFn} removeSupplierInvoice={removeSupplierInvoiceFn}
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
  stockBatches, orderStock, deliverStock, cancelOrder, amendOrder,
  priceHistory, recordPrice, pendingReorder, showReorderAlert, setShowReorderAlert, setDismissedReorderIds,
  updatePriceHistorySupplier, updateStockBatchSupplier,
  auditLog, addAuditLog,
  partsForecastShortfalls, showForecastAlert, dismissForecastAlert,
  jobCards, jobApprovals, updateJobApproval, removeJobApproval,
  brands, addBrand, removeBrand, renameBrand, updateJobTypeBrand, removeJobType, updateJobTypeStandardPrice, updateJobTypePublicBookable,
  holidays, addHoliday, removeHoliday,
  bonusRates, addBonusRate, updateBonusRate, updateBonusRateJobTypes, removeBonusRate,
  staffWages, upsertStaffWage, removeStaffWage,
  fixedCosts, addFixedCost, updateFixedCost, removeFixedCost,
  suppliers, addSupplier, updateSupplierField, removeSupplier,
  supplierInvoices, updateSupplierInvoiceField, removeSupplierInvoice,
}) {
  const [tab, setTab] = useState("calendar");
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState(todayISO());
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [editingBooking, setEditingBooking] = useState(null);
  const [printJob, setPrintJob] = useState(null);
  const [printJobs, setPrintJobs] = useState(null);
  const [printStillToFinish, setPrintStillToFinish] = useState(false);
  const [printOutstandingParts, setPrintOutstandingParts] = useState(false);
  const [bookingRequests, setBookingRequests] = useState([]);
  // "Who's calling?" — lets office staff check an incoming caller's number
  // against past bookings before or during the call, and falls back to a
  // few external lookup links when the number isn't in the system at all.
  const [callerQuery, setCallerQuery] = useState("");
  const [callerBoxOpen, setCallerBoxOpen] = useState(false);
  // Set while converting a pending request into a real booking — prefills
  // NewBookingModal without treating it as an edit, and tells the onSave
  // handler below which request to mark converted once it's saved.
  const [acceptingRequest, setAcceptingRequest] = useState(null);

  // Public /book submissions land in booking_requests, not bookings — this
  // is the one place office actually sees them, since nothing auto-converts
  // a request into a real booking. Refetched on mount and after every
  // accept/decline rather than realtime, since this is a low-volume,
  // session-gated admin table rather than one of the anon-RLS tables the
  // rest of the app subscribes to.
  const refreshBookingRequests = () => {
    fetch("/api/office/booking-requests")
      .then((r) => r.json())
      .then((d) => setBookingRequests(d.requests || []))
      .catch(() => {});
  };
  useEffect(() => { refreshBookingRequests(); }, []);

  const declineRequest = (id) => {
    fetch("/api/office/booking-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "declined" }),
    }).then(refreshBookingRequests);
  };

  // Jumps to a booking's day on the Calendar tab — shared by the Jobs
  // table and the Profitability tab's outstanding-pricing list, so
  // clicking either one lands you on the same booking the same way.
  const openBookingOnCalendar = (b) => {
    setMonthCursor(new Date(new Date(b.date).getFullYear(), new Date(b.date).getMonth(), 1));
    setSelectedDay(b.date);
    setTab("calendar");
  };

  // Matches for the "Who's calling?" box — needs at least 3 digits typed
  // before it searches, so it doesn't dump the whole booking list on a
  // single keystroke. Most recent visit first.
  const callerDigits = normalizePhone(callerQuery);
  const callerMatches = useMemo(() => {
    if (callerDigits.length < 3) return [];
    return bookings
      .filter((b) => normalizePhone(b.phone).includes(callerDigits))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);
  }, [bookings, callerDigits]);

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

  // Same pattern, for reprinting several job cards at once from the Jobs
  // tab (e.g. every car currently in) — one physical stack in one go
  // instead of opening and printing each booking one at a time.
  useEffect(() => {
    if (!printJobs || printJobs.length === 0) return;
    const t = setTimeout(() => window.print(), 50);
    const clear = () => setPrintJobs(null);
    window.addEventListener("afterprint", clear);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", clear); };
  }, [printJobs]);

  // Same pattern again, for the daily "jobs still to finish" sheet.
  useEffect(() => {
    if (!printStillToFinish) return;
    const t = setTimeout(() => window.print(), 50);
    const clear = () => setPrintStillToFinish(false);
    window.addEventListener("afterprint", clear);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", clear); };
  }, [printStillToFinish]);

  // Same pattern again, for the daily "outstanding parts" sheet.
  useEffect(() => {
    if (!printOutstandingParts) return;
    const t = setTimeout(() => window.print(), 50);
    const clear = () => setPrintOutstandingParts(false);
    window.addEventListener("afterprint", clear);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", clear); };
  }, [printOutstandingParts]);

  return (
    <div>
      <div className="wb-callerbox">
        <div style={{ position: "relative", maxWidth: 320, width: "100%" }}>
          <Phone size={14} color="var(--muted)" style={{ position: "absolute", left: 12, top: 14 }} />
          <input
            className="wb-input"
            style={{ paddingLeft: 34 }}
            placeholder="Who's calling? Type their number…"
            value={callerQuery}
            onChange={(e) => setCallerQuery(e.target.value)}
            onFocus={() => setCallerBoxOpen(true)}
            onBlur={() => setTimeout(() => setCallerBoxOpen(false), 150)}
          />
          {callerBoxOpen && callerDigits.length >= 3 && (
            <div className="wb-callerdropdown wb-panel">
              {callerMatches.length > 0 ? (
                callerMatches.map((b) => (
                  <div
                    key={b.id}
                    className="wb-callerresult"
                    onMouseDown={() => { openBookingOnCalendar(b); setCallerQuery(""); setCallerBoxOpen(false); }}
                  >
                    <div style={{ fontWeight: 600 }}>{b.customer_name || "(no name)"}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{b.reg} · {b.date} · {b.phone}</div>
                    {b.symptoms && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{b.symptoms}</div>}
                  </div>
                ))
              ) : (
                <div style={{ padding: 4 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                    No matching booking. There's no reliable free service to auto-identify a UK mobile — try these instead:
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <a className="wb-callerlink" href={`https://www.google.com/search?q=${encodeURIComponent(callerQuery)}`} target="_blank" rel="noreferrer">Google search the number</a>
                    <a className="wb-callerlink" href={`https://wa.me/${callerDigits.startsWith("0") ? "44" + callerDigits.slice(1) : callerDigits}`} target="_blank" rel="noreferrer">Check WhatsApp (name/photo if they're on it)</a>
                    <a className="wb-callerlink" href={`https://www.truecaller.com/search/gb/${callerDigits}`} target="_blank" rel="noreferrer">Truecaller web lookup</a>
                    <a className="wb-callerlink" href={`https://www.192.com/search/telephone/results/?number=${callerDigits}`} target="_blank" rel="noreferrer">192.com lookup</a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="wb-tabs">
        {[["calendar", "Calendar", Calendar], ["jobs", "Jobs", List], ["requests", "Booking Requests", Inbox], ["stock", "Stock & Reorder", Package], ["supplierinvoices", "Supplier Invoices", FileText], ["suppliers", "Suppliers", Truck], ["jobtypes", "Job Types", ListChecks], ["holidays", "Holidays", Sun], ["forecast", "Forecast", TrendingUp], ["profitability", "Profitability", PoundSterling], ["audit", "Corrections & Deletions", History], ["settings", "Settings", SettingsIcon]].map(([key, label, Icon]) => (
          <div key={key} className={`wb-tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>
            <Icon size={14} /> {label}
            {key === "stock" && lowStockItems.length > 0 && <span className="wb-badge-low" style={{ marginLeft: 4 }}>{lowStockItems.length}</span>}
            {key === "requests" && bookingRequests.length > 0 && <span className="wb-badge-low" style={{ marginLeft: 4 }}>{bookingRequests.length}</span>}
            {key === "supplierinvoices" && supplierInvoices.filter((i) => i.status === "needs_review").length > 0 && (
              <span className="wb-badge-low" style={{ marginLeft: 4 }}>{supplierInvoices.filter((i) => i.status === "needs_review").length}</span>
            )}
          </div>
        ))}
      </div>
      <div className="wb-body">
        {tab === "calendar" && (
          <CalendarTab monthCursor={monthCursor} setMonthCursor={setMonthCursor} bookings={bookings} selectedDay={selectedDay} setSelectedDay={setSelectedDay}
            onNewBooking={() => setShowNewBooking(true)} onEditBooking={(b) => setEditingBooking(b)} onPrintJob={setPrintJob}
            jobTypes={jobTypes} parts={parts} settings={settings} removeBooking={removeBooking} updateBooking={updateBooking}
            jobCards={jobCards} jobApprovals={jobApprovals} updateJobApproval={updateJobApproval} removeJobApproval={removeJobApproval}
            holidays={holidays} />
        )}
        {tab === "jobs" && (
          <JobsTableTab
            bookings={bookings} jobTypes={jobTypes}
            onOpenBooking={openBookingOnCalendar}
            onPrintSelected={setPrintJobs}
            onPrintStillToFinish={() => setPrintStillToFinish(true)}
          />
        )}
        {tab === "requests" && (
          <BookingRequestsTab
            requests={bookingRequests} jobTypes={jobTypes} bookings={bookings} holidays={holidays}
            onAccept={(req) => setAcceptingRequest(req)}
            onDecline={(req) => { if (confirm(`Decline the request from ${req.name}?`)) declineRequest(req.id); }}
            onRefresh={refreshBookingRequests}
          />
        )}
        {tab === "stock" && (
          <StockTab stockRows={stockRows} jobTypes={jobTypes} receiveStock={receiveStock} updatePartField={updatePartField} removePart={removePart}
            stockBatches={stockBatches} orderStock={orderStock} deliverStock={deliverStock} cancelOrder={cancelOrder} amendOrder={amendOrder}
            priceHistory={priceHistory} recordPrice={recordPrice} brands={brands} addBrand={addBrand} removeBrand={removeBrand} renameBrand={renameBrand}
            addAuditLog={addAuditLog} onPrintOutstandingParts={() => setPrintOutstandingParts(true)} />
        )}
        {tab === "supplierinvoices" && (
          <SupplierInvoicesTab
            suppliers={suppliers} addSupplier={addSupplier} updateSupplierField={updateSupplierField} removeSupplier={removeSupplier}
            supplierInvoices={supplierInvoices} updateSupplierInvoiceField={updateSupplierInvoiceField} removeSupplierInvoice={removeSupplierInvoice}
            stockBatches={stockBatches} parts={parts}
          />
        )}
        {tab === "suppliers" && (
          <SuppliersTab priceHistory={priceHistory} parts={parts} brands={brands} jobTypes={jobTypes} stockBatches={stockBatches}
            updatePriceHistorySupplier={updatePriceHistorySupplier} updateStockBatchSupplier={updateStockBatchSupplier} />
        )}
        {tab === "jobtypes" && (
          <JobTypesTab jobTypes={jobTypes} parts={parts} bookings={bookings} addPart={addPart} addJobType={addJobType} renameJobType={renameJobType}
            updateJobTypeColor={updateJobTypeColor} addBomLine={addBomLine} updateBomQty={updateBomQty} removeBomLine={removeBomLine}
            brands={brands} updateJobTypeBrand={updateJobTypeBrand} removeJobType={removeJobType}
            updateJobTypeStandardPrice={updateJobTypeStandardPrice} updateJobTypePublicBookable={updateJobTypePublicBookable} />
        )}
        {tab === "holidays" && (
          <HolidaysTab holidays={holidays} addHoliday={addHoliday} removeHoliday={removeHoliday} />
        )}
        {tab === "forecast" && (
          <ProfitabilityGate>
            <ForecastTab bookings={bookings} jobTypes={jobTypes} settings={settings} onOpenBooking={openBookingOnCalendar} />
          </ProfitabilityGate>
        )}
        {tab === "profitability" && (
          <ProfitabilityGate>
            <ProfitabilityTab
              bookings={bookings} jobTypes={jobTypes} parts={parts} settings={settings}
              bonusRates={bonusRates} addBonusRate={addBonusRate} updateBonusRate={updateBonusRate} updateBonusRateJobTypes={updateBonusRateJobTypes} removeBonusRate={removeBonusRate}
              staffWages={staffWages} upsertStaffWage={upsertStaffWage} removeStaffWage={removeStaffWage}
              fixedCosts={fixedCosts} addFixedCost={addFixedCost} updateFixedCost={updateFixedCost} removeFixedCost={removeFixedCost}
            />
          </ProfitabilityGate>
        )}
        {tab === "audit" && (
          <ProfitabilityGate>
            <AuditLogTab auditLog={auditLog} />
          </ProfitabilityGate>
        )}
        {tab === "settings" && <SettingsTab settings={settings} updateSettingsField={updateSettingsField} />}
      </div>
      {(showNewBooking || editingBooking || acceptingRequest) && (
        <NewBookingModal
          jobTypes={jobTypes} parts={parts} settings={settings} brands={brands} defaultDate={selectedDay} booking={editingBooking}
          initialValues={acceptingRequest ? {
            customerName: acceptingRequest.name, phone: acceptingRequest.phone, email: acceptingRequest.email, reg: acceptingRequest.reg,
            business: acceptingRequest.business, date: acceptingRequest.date, pickupAddress: acceptingRequest.address,
            symptoms: [
              acceptingRequest.is_non_runner ? "NON-RUNNER" : null,
              acceptingRequest.symptoms || null,
              acceptingRequest.is_emergency
                ? `Emergency appointment — 2nd choice date ${acceptingRequest.second_date || "—"}`
                : acceptingRequest.other_details
                ? acceptingRequest.other_details
                : (acceptingRequest.requirements || []).join(", "),
            ].filter(Boolean).join("\n"),
            jobTypeId: jobTypes.find((jt) => (acceptingRequest.requirements || []).some((r) => r.toLowerCase() === jt.name.toLowerCase()))?.id,
          } : undefined}
          onClose={() => { setShowNewBooking(false); setEditingBooking(null); setAcceptingRequest(null); }}
          onSave={(b) => {
            if (editingBooking) {
              updateBooking(editingBooking.id, b);
            } else {
              addBooking(b);
              setPrintJob(b);
            }
            if (acceptingRequest) {
              fetch("/api/office/booking-requests", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: acceptingRequest.id, status: "converted" }),
              }).then(refreshBookingRequests);
            }
            setShowNewBooking(false); setEditingBooking(null); setAcceptingRequest(null); setSelectedDay(b.date);
          }}
        />
      )}
      {printJob && <JobCardPrintout booking={printJob} jobTypes={jobTypes} />}
      {printJobs && printJobs.length > 0 && <JobCardsPrintout bookings={printJobs} jobTypes={jobTypes} />}
      {printStillToFinish && <JobsStillToFinishPrintout rows={stillToFinishRows(bookings, jobTypes)} />}
      {printOutstandingParts && <OutstandingPartsPrintout rows={outstandingPartsRows(stockBatches, parts)} />}
      {showReorderAlert && pendingReorder.length > 0 && (
        <ReorderAlertModal
          items={pendingReorder}
          priceHistory={priceHistory}
          stockBatches={stockBatches}
          orderStock={orderStock}
          deliverStock={deliverStock}
          onClose={() => setShowReorderAlert(false)}
          onDismiss={() => {
            setDismissedReorderIds((prev) => new Set([...prev, ...pendingReorder.map((r) => r.id)]));
            setShowReorderAlert(false);
          }}
        />
      )}
      {showForecastAlert && partsForecastShortfalls.length > 0 && (
        <PartsForecastModal
          shortfalls={partsForecastShortfalls}
          onOpenBooking={(s) => { dismissForecastAlert(); openBookingOnCalendar({ date: s.date }); }}
          onClose={dismissForecastAlert}
        />
      )}
    </div>
  );
}

// Printed the moment a new booking is saved (see OfficeMode's onSave) so it
// can go straight into a physical pile at reception — techs work through the
// pile one job card at a time. Plain black-on-white regardless of the app's
// dark theme, since it's meant for a printer, not a screen.
function JobCardBody({ booking, jobTypes }) {
  const jt = jobTypes.find((j) => j.id === booking.jobTypeId);
  const extraJts = (booking.extraJobTypeIds || []).map((id) => jobTypes.find((j) => j.id === id)).filter(Boolean);
  const jobTypeLabel = [jt?.name, ...extraJts.map((e) => e.name)].filter(Boolean).join(" + ");
  // The customer's requested-by date is the last day of the booked-in
  // span, not a separate field — a job entered as 3 days from Mon is
  // wanted back by Wed, so this is computed from date+days rather than
  // needing office to type it in a second time.
  const requiredByDate = booking.date ? addDaysISO(booking.date, (booking.days || 1) - 1) : "";
  const rows = [
    ["Business", booking.business],
    ["Booking date", booking.date ? fmtDate(booking.date) : ""],
    ["Required by", requiredByDate ? fmtDate(requiredByDate) : ""],
    ["Customer name", booking.customerName],
    ["Address", booking.pickupAddress],
    ["Phone", booking.phone],
    ["Vehicle registration", booking.reg],
    ["Vehicle model", booking.vehicleModel],
    ["Booked in for", jobTypeLabel],
  ].filter(([, value]) => value);

  return (
    <div style={{ padding: 20, color: "#000", background: "#fff", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 2 }}>{booking.business}</div>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: "#555", marginBottom: 12 }}>JOB CARD</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 12 }}>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td style={{ padding: "3px 10px 3px 0", fontWeight: 700, verticalAlign: "top", whiteSpace: "nowrap" }}>{label}</td>
              <td style={{ padding: "3px 0", borderBottom: "1px solid #ccc" }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Customer notes</div>
      <div style={{ border: "1px solid #000", borderRadius: 4, padding: 6, minHeight: 50, fontSize: 11, whiteSpace: "pre-wrap", marginBottom: 12 }}>
        {booking.symptoms || "—"}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Comments</div>
      <div style={{ border: "1px solid #000", borderRadius: 4, minHeight: 110 }} />
    </div>
  );
}

function JobCardPrintout({ booking, jobTypes }) {
  return (
    <div className="print-job-card">
      <JobCardBody booking={booking} jobTypes={jobTypes} />
    </div>
  );
}

// Bulk version for the Jobs tab — print a stack of job cards (e.g. every
// car currently in) in one go. Each booking gets its own page: unlike the
// single-card case above, these can't all sit at position:absolute;top:0
// or they'd print stacked on top of each other, so this uses a separate
// container that lays its children out normally and breaks the page after
// each one instead.
function JobCardsPrintout({ bookings, jobTypes }) {
  return (
    <div className="print-job-cards">
      {bookings.map((b) => (
        <div key={b.id} className="print-job-card-page">
          <JobCardBody booking={b} jobTypes={jobTypes} />
        </div>
      ))}
    </div>
  );
}

// A single sheet listing every job still outstanding, oldest first —
// printed each morning and worked through top to bottom, rather than one
// card per booking like JobCardsPrintout above.
const STF_COLS = ["Booked in", "Required by", "Customer", "Reg", "Vehicle", "Business", "Job type", "Status"];
const STF_KEYS = ["dateLabel", "requiredByLabel", "customerName", "reg", "vehicleModel", "business", "jobTypeLabel", "status"];
function JobsStillToFinishPrintout({ rows }) {
  return (
    <div className="print-still-to-finish">
      <div style={{ padding: 24, color: "#000", background: "#fff", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 2 }}>Jobs still to finish</div>
        <div style={{ fontSize: 11, color: "#555", marginBottom: 16 }}>Printed {new Date().toLocaleString("en-GB")} — oldest first</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>
              {STF_COLS.map((h) => (
                <th key={h} style={{ textAlign: "left", borderBottom: "2px solid #000", padding: "5px 8px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {STF_KEYS.map((k) => (
                  <td key={k} style={{ padding: "5px 8px", borderBottom: "1px solid #ccc" }}>{r[k]}</td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={STF_COLS.length} style={{ padding: "10px 8px", color: "#555" }}>Nothing outstanding — every booked job is workshop completed.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Same pattern again, for stock orders placed but not yet delivered.
const OP_COLS = ["Part", "Qty", "Price", "Supplier", "Ordered", "Due"];
const OP_KEYS = ["partName", "qty", "price", "supplier", "orderedLabel", "dueLabel"];
function OutstandingPartsPrintout({ rows }) {
  return (
    <div className="print-outstanding-parts">
      <div style={{ padding: 24, color: "#000", background: "#fff", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 2 }}>Outstanding parts</div>
        <div style={{ fontSize: 11, color: "#555", marginBottom: 16 }}>Printed {new Date().toLocaleString("en-GB")} — soonest due first</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>
              {OP_COLS.map((h) => (
                <th key={h} style={{ textAlign: "left", borderBottom: "2px solid #000", padding: "5px 8px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {OP_KEYS.map((k) => (
                  <td key={k} style={{ padding: "5px 8px", borderBottom: "1px solid #ccc", color: k === "dueLabel" && r.overdue ? "#b3261e" : "#000", fontWeight: k === "dueLabel" && r.overdue ? 700 : 400 }}>
                    {r[k]}{k === "dueLabel" && r.overdue ? " (overdue)" : ""}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={OP_COLS.length} style={{ padding: "10px 8px", color: "#555" }}>Nothing on order — everything's been delivered.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Pops up when parts drop below reorder cover. Shows what's needed plus the
// 12-month low from that part's price history, and offers to copy a ready
// -made summary to paste to Claude in chat for a live price comparison —
// there's no search API wired into the app itself, so this is the bridge.
function ReorderAlertModal({ items, priceHistory, stockBatches, orderStock, deliverStock, onClose, onDismiss }) {
  const [copiedId, setCopiedId] = useState(null);
  const yearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const [orderAmounts, setOrderAmounts] = useState({}); // { [partId]: { qty, price } }

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

  // What's already been ordered for each of these parts, so the alert
  // doesn't nag about something that's already on its way — and a
  // "Received" button right here to log it arriving without going to the
  // Stock tab. Once it's marked received, physical stock goes up and this
  // part drops off the low-stock list on its own (or shrinks the shortfall
  // if only some of it just arrived).
  const pendingByPart = useMemo(() => {
    const map = {};
    stockBatches.filter((b) => b.status === "ordered").forEach((b) => { (map[b.partId] = map[b.partId] || []).push(b); });
    return map;
  }, [stockBatches]);

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

  const placeOrder = (r) => {
    const qty = parseFloat(orderAmounts[r.item.id]?.qty);
    const price = parseFloat(orderAmounts[r.item.id]?.price) || r.lastPrice;
    if (!qty || qty <= 0 || !price || price < 0) return;
    orderStock(r.item.id, qty, price, null, null);
    setOrderAmounts((prev) => ({ ...prev, [r.item.id]: { qty: "", price: "" } }));
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
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => {
            const pending = pendingByPart[r.item.id] || [];
            return (
              <div key={r.item.id} className="wb-panel" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{r.item.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {r.item.partNumber ? `${r.item.partNumber} · ` : ""}Last ordered {r.lastOrderQty ?? "?"} @ £{r.lastPrice.toFixed(2)}{r.lowest12mo !== null ? ` · 12-mo low £${r.lowest12mo.toFixed(2)}` : ""}
                    </div>
                  </div>
                  <button className="wb-btn-ghost" style={{ padding: "6px 10px", minHeight: 30, whiteSpace: "nowrap" }} onClick={() => copyDetails(r)}>
                    {copiedId === r.item.id ? "Copied ✓" : "Search for a better price?"}
                  </button>
                </div>

                <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {pending.length > 0 ? "Already on order" : "Nothing on order yet"}
                </div>
                {pending.length > 0 && (
                  <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                    {pending.map((b) => (
                      <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                        <span className="wh-mono">{b.qtyRemaining} @ £{b.price.toFixed(2)}</span>
                        {b.supplier && <span style={{ color: "var(--muted)" }}>from {b.supplier}</span>}
                        <button className="wb-btn-ghost" style={{ padding: "4px 10px", minHeight: 28, fontSize: 11, whiteSpace: "nowrap" }} onClick={() => deliverStock(b.id)}>
                          <Truck size={11} style={{ display: "inline", marginRight: 3 }} />Received
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>Order</span>
                  <input
                    type="number" className="wb-input" style={{ width: 60 }} placeholder="qty"
                    value={orderAmounts[r.item.id]?.qty || ""}
                    onChange={(e) => setOrderAmounts((prev) => ({ ...prev, [r.item.id]: { ...prev[r.item.id], qty: e.target.value } }))}
                  />
                  <input
                    type="number" step="0.01" className="wb-input" style={{ width: 80 }} placeholder={`£${r.lastPrice.toFixed(2)}`}
                    value={orderAmounts[r.item.id]?.price || ""}
                    onChange={(e) => setOrderAmounts((prev) => ({ ...prev, [r.item.id]: { ...prev[r.item.id], price: e.target.value } }))}
                  />
                  <button className="wb-btn-ghost" style={{ padding: "6px 12px", minHeight: 30 }} onClick={() => placeOrder(r)}>Order</button>
                </div>
              </div>
            );
          })}
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

// Daily heads-up: which parts will run out before an already-booked job
// needs them, and on which day that first bites — computed by walking the
// diary chronologically (see partsForecastShortfalls at the root), not just
// today's stock level. Clicking a row jumps straight to that booking on the
// Calendar so it's obvious which job is at risk.
function PartsForecastModal({ shortfalls, onOpenBooking, onClose }) {
  return (
    <div className="wb-modal-backdrop" onClick={onClose}>
      <div className="wb-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8, color: "var(--red)" }}>
            <AlertTriangle size={16} /> Parts needed for booked-in jobs
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Based on what's already booked in, not just today's stock level — order these before the date shown or that job will be short.
          </div>
          {shortfalls.map((s) => (
            <div
              key={s.partId} className="wb-panel" style={{ padding: 12, cursor: "pointer" }}
              onClick={() => onOpenBooking(s)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{s.partName}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--red)" }}>Short by {s.shortBy}</div>
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                Needed by {fmtDate(s.date)}{s.customerName ? ` for ${s.customerName}` : ""} — tap to open on Calendar
              </div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="wb-btn" onClick={onClose}>Got it</button>
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

// Everything the workshop still has physically outstanding — same "not
// workshop completed, not collected" cutoff used for capacity elsewhere
// (see realBookingCountForDate), since a job only waiting on collection
// isn't work still to do. Oldest booking date first, so the most overdue
// job is what a technician picks up first from the printed/PDF list.
function stillToFinishRows(bookings, jobTypes) {
  const jtIndex = Object.fromEntries(jobTypes.map((j) => [j.id, j.name]));
  return bookings
    .filter((b) => !b.workshopCompleted && !b.completed && b.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((b) => {
      const jt = jtIndex[b.jobTypeId];
      const extraNames = (b.extraJobTypeIds || []).map((id) => jtIndex[id]).filter(Boolean);
      const jobTypeLabel = [jt, ...extraNames].filter(Boolean).join(" + ") || "—";
      const requiredBy = addDaysISO(b.date, (b.days || 1) - 1);
      return {
        id: b.id,
        dateLabel: fmtDate(b.date),
        requiredByLabel: fmtDate(requiredBy),
        customerName: b.customerName || "Unnamed",
        reg: b.reg || "—",
        vehicleModel: b.vehicleModel || "",
        business: b.business || "",
        jobTypeLabel,
        status: b.arrived ? "Arrived" : "Not started",
      };
    });
}

// Every stock order placed but not yet delivered, with its supplier — so
// office can see in one place what's still owed and by when. Soonest due
// date first (an overdue one is already in the past, so it naturally sorts
// to the top); orders with no due date set sort to the very end instead of
// jumping the queue.
function outstandingPartsRows(stockBatches, parts) {
  const partIndex = Object.fromEntries(parts.map((p) => [p.id, p.name]));
  return stockBatches
    .filter((b) => b.status === "ordered")
    .sort((a, b) => {
      const ad = a.dueDate || "9999-12-31";
      const bd = b.dueDate || "9999-12-31";
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.orderedAt < b.orderedAt ? -1 : a.orderedAt > b.orderedAt ? 1 : 0;
    })
    .map((b) => ({
      id: b.id,
      partName: partIndex[b.partId] || "Unknown part",
      qty: b.qtyRemaining,
      price: `£${Number(b.price).toFixed(2)}`,
      supplier: b.supplier || "—",
      orderedLabel: fmtDate(b.orderedAt.slice(0, 10)),
      dueLabel: b.dueDate ? fmtDate(b.dueDate) : "—",
      overdue: !!(b.dueDate && b.dueDate < todayISO()),
    }));
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

function CalendarTab({ monthCursor, setMonthCursor, bookings, selectedDay, setSelectedDay, onNewBooking, onEditBooking, onPrintJob, jobTypes, parts, settings, removeBooking, updateBooking, jobCards, jobApprovals, updateJobApproval, removeJobApproval, holidays }) {
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <button className="wb-btn" onClick={onNewBooking}><Plus size={14} /> New booking</button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="wb-btn-ghost" onClick={() => setMonthCursor(new Date(year, month - 1, 1))}><ChevronLeft size={14} /></button>
            <div style={{ fontWeight: 700, fontSize: 15, minWidth: 150, textAlign: "center" }}>{monthCursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
            <button className="wb-btn-ghost" onClick={() => setMonthCursor(new Date(year, month + 1, 1))}><ChevronRight size={14} /></button>
          </div>
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
            // Red star for any day someone's off — a quick visual check
            // before booking a job in, not tied to any particular booking.
            const onHoliday = (holidays || []).filter((h) => iso >= h.dateFrom && iso <= h.dateTo);
            return (
              <div
                key={i} className={`wb-day ${iso === selectedDay ? "selected" : ""} ${isToday ? "today" : ""}`}
                onClick={() => { setSelectedDay(iso); if (dayBk.length > 0) setMobileDayOpen(true); }}
                style={{ position: "relative" }}
                title={onHoliday.length > 0 ? `Holiday: ${onHoliday.map((h) => h.name).join(", ")}` : undefined}
              >
                {onHoliday.length > 0 && (
                  <div style={{ position: "absolute", top: 3, right: 3, display: "flex", gap: 2 }}>
                    {onHoliday.map((h) => (
                      <Star key={h.id} size={14} fill={holidayColor(h.name)} color={holidayColor(h.name)} />
                    ))}
                  </div>
                )}
                <div className="wb-daynum">{d}</div>
                {dayBk.slice(0, 5).map((b) => {
                  const st = bookingStatus(b);
                  // The drop-off day (a multi-day booking's first day) gets
                  // a bright blue border on top of the normal status/yellow
                  // colouring, so a glance at the month view shows what's
                  // coming in that day without losing the status colour.
                  const isDropOffDay = iso === b.date;
                  return (
                    <span
                      key={b.id}
                      className={`wb-chip ${b.business === "Timing Chain Specialists" ? "tcs" : ""}`}
                      style={{
                        ...(st.color ? { color: st.color, background: "transparent", border: `1px solid ${st.color}` } : {}),
                        ...(isDropOffDay ? { border: "2px solid #2979ff" } : {}),
                      }}
                      title={isDropOffDay ? "Drop-off day" : st.label}
                    >
                      {b.customerName || "Booking"}
                    </span>
                  );
                })}
                {dayBk.length > 5 && <span style={{ fontSize: 10, color: "var(--muted)" }}>+{dayBk.length - 5} more</span>}
                {dayBk.length > 0 && (
                  <div className="wb-day-dots">
                    {dayBk.slice(0, 8).map((b) => {
                      const st = bookingStatus(b);
                      return <span key={b.id} className="wb-day-dot" style={st.color ? { background: st.color } : undefined} title={b.customerName || "Booking"} />;
                    })}
                    {dayBk.length > 8 && <span className="wb-day-more">+{dayBk.length - 8}</span>}
                  </div>
                )}
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
                  <BookingShareActions booking={b} jobTypes={jobTypes} />
                </div>
                {b.vehicleModel && (
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#38bdf8", marginTop: 6 }}>
                    {b.vehicleModel}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--amber2)", marginTop: 2 }}>
                  {jt?.name || "—"}{extraJts.length > 0 && ` + ${extraJts.map((e) => e.name).join(" + ")}`}
                </div>
                {b.paymentMethod && (
                  // Deliberately shown up front, not tucked inside the collapsible
                  // Job pricing panel — the whole point is that whoever picks up
                  // payment can see what was agreed without hunting for it.
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green)", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                    <PoundSterling size={11} /> {b.paymentMethod} agreed
                  </div>
                )}
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
function JobsTableTab({ bookings, jobTypes, onOpenBooking, onPrintSelected, onPrintStillToFinish }) {
  const [showCollected, setShowCollected] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  // Which rows are ticked for a bulk reprint — e.g. tick every car
  // currently "Arrived" top to bottom, then print the lot in one go
  // instead of opening and printing each booking one at a time.
  const [selected, setSelected] = useState(() => new Set());
  const jtIndex = useMemo(() => Object.fromEntries(jobTypes.map((j) => [j.id, j.name])), [jobTypes]);
  const rows = useMemo(() => {
    return bookings
      .filter((b) => showCollected || !b.completed)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [bookings, showCollected]);
  const allVisibleSelected = rows.length > 0 && rows.every((b) => selected.has(b.id));
  const toggleRow = (id) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAllVisible = () => setSelected((prev) => {
    if (allVisibleSelected) return new Set();
    return new Set(rows.map((b) => b.id));
  });
  const printSelected = () => {
    const chosen = rows.filter((b) => selected.has(b.id));
    if (chosen.length === 0) return;
    onPrintSelected(chosen);
    setSelected(new Set());
  };

  // Downloads a PDF of every outstanding job (oldest first) — separate from
  // the print button, which sends the same sheet to the reception printer
  // instead of a file that can be forwarded to a technician directly.
  const downloadStillToFinishPdf = async () => {
    setDownloadingPdf(true);
    try {
      const stfRows = stillToFinishRows(bookings, jobTypes);
      const res = await fetch("/api/office/jobs-still-to-finish-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: stfRows, generatedAt: new Date().toISOString() }),
      });
      if (!res.ok) { alert("Failed to generate the PDF."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jobs-still-to-finish-${todayISO()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to generate the PDF — check your connection and try again.");
    }
    setDownloadingPdf(false);
  };

  return (
    <div className="wb-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Jobs</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={showCollected} onChange={(e) => setShowCollected(e.target.checked)} /> Show collected
          </label>
          <button className="wb-btn-ghost" onClick={onPrintStillToFinish} title="Print every outstanding job, oldest first">
            <Printer size={13} /> Print daily list
          </button>
          <button className="wb-btn-ghost" disabled={downloadingPdf} style={downloadingPdf ? { opacity: 0.5, cursor: "not-allowed" } : {}} onClick={downloadStillToFinishPdf} title="Download the same list as a PDF to send to the guys">
            <Download size={13} /> {downloadingPdf ? "Generating…" : "Download PDF"}
          </button>
          <button className="wb-btn" disabled={selected.size === 0} style={selected.size === 0 ? { opacity: 0.5, cursor: "not-allowed" } : {}} onClick={printSelected}>
            <Printer size={13} /> Print selected{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="wb-table">
          <thead>
            <tr>
              <th style={{ width: 30 }}><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} /></th>
              <th>Date</th><th>Customer</th><th>Reg</th><th>Business</th><th>Job type</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const st = bookingStatus(b);
              return (
                <tr key={b.id} onClick={() => onOpenBooking(b)} style={{ cursor: "pointer" }}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(b.id)} onChange={() => toggleRow(b.id)} /></td>
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
              <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No jobs to show.</td></tr>
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

// Job value/labour/parts cost and profit used to be visible here — this is
// now pricing entry and transport/invoicing only. Profit stays visible in
// one place, the password-gated Profitability tab, rather than to anyone
// scanning a booking on the calendar.
function JobCostBlock({ booking, jt, jobTypes, parts, settings, updateBooking }) {
  const [open, setOpen] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
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
        <div style={{ fontSize: 10, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}><PoundSterling size={10} /> Job pricing</div>
        <ChevronDown size={12} style={{ color: "var(--muted)", transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.1s" }} />
      </div>
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <div><label className="wb-label">Job value £</label><input type="number" className="wb-input" value={booking.jobValue || ""} onChange={(e) => updateBooking(booking.id, { jobValue: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="wb-label">Labour £</label><input type="number" className="wb-input" value={booking.labourCost || ""} onChange={(e) => updateBooking(booking.id, { labourCost: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="wb-label">Transport £</label><input type="number" className="wb-input" value={booking.transportCost || ""} onChange={(e) => updateBooking(booking.id, { transportCost: parseFloat(e.target.value) || 0 })} /></div>
          </div>
          {isTimingChainReplacement(jt) && !booking.jobValue && (
            <button className="wb-btn-ghost" onClick={() => updateBooking(booking.id, STANDARD_TIMING_CHAIN_PRICE)}>Use standard timing chain pricing</button>
          )}
          {needsQuote && <button className="wb-btn-ghost" onClick={draftQuoteEmail}><Mail size={12} /> Draft transport quote request</button>}
          <div>
            <label className="wb-label">Payment method (agreed)</label>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {PAYMENT_METHODS.map((m) => (
                <label key={m} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                  <input
                    type="checkbox" checked={booking.paymentMethod === m}
                    onChange={() => updateBooking(booking.id, { paymentMethod: booking.paymentMethod === m ? "" : m })}
                  /> {m}
                </label>
              ))}
            </div>
          </div>
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
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!booking.transportCollected} onChange={(e) => updateBooking(booking.id, { transportCollected: e.target.checked })} /> Collected
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!booking.transportDelivered} onChange={(e) => updateBooking(booking.id, { transportDelivered: e.target.checked })} /> Delivered
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!booking.transportCustomerPaid} onChange={(e) => updateBooking(booking.id, { transportCustomerPaid: e.target.checked })} /> Customer paid
                </label>
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

// How many of each job type have actually been completed — main job AND
// every extra job type on the booking both counted (a Timing Chain +
// Turbo booking counts once for each). Shared between Profitability and
// Forecast so "how many have we done" can't drift between the two tabs
// from being computed two different ways.
// How many bonus-qualifying jobs actually happened in a given month, per
// bonus type — driven entirely by real booking data (completed, priced,
// and invoiced) rather than a number someone has to remember to type in.
// Grouped by the month the job was actually completed in, not the month it
// was originally booked for, since that's when the work — and the bonus —
// is actually earned. A bonus rate with no job types linked never counts
// anything, rather than guessing from its name.
function computeBonusCounts(bookings, bonusRates, month) {
  const counts = {};
  bonusRates.forEach((br) => { counts[br.id] = 0; });
  bookings.forEach((b) => {
    if (!b.completed || !(b.jobValue > 0) || !b.zohoInvoiceId) return;
    const completedMonth = b.completedAt ? new Date(b.completedAt).toISOString().slice(0, 7) : (b.date || "").slice(0, 7);
    if (completedMonth !== month) return;
    const ids = new Set([b.jobTypeId, ...(b.extraJobTypeIds || [])].filter(Boolean));
    bonusRates.forEach((br) => {
      if ((br.jobTypeIds || []).some((jtId) => ids.has(jtId))) counts[br.id] += 1;
    });
  });
  return counts;
}

function jobTypeCompletionCounts(bookings, jobTypes) {
  const counts = {};
  bookings.filter((b) => b.completed && (b.jobValue || 0) > 0).forEach((b) => {
    const ids = [b.jobTypeId, ...(b.extraJobTypeIds || [])].filter(Boolean);
    ids.forEach((id) => {
      const name = jobTypes.find((j) => j.id === id)?.name || "Unknown job type";
      counts[name] = (counts[name] || 0) + 1;
    });
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
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

function ForecastTab({ bookings, jobTypes, settings, onOpenBooking }) {
  const monthlyTarget = settings.monthlyTarget || 40000;
  const workingDaysPerMonth = settings.workingDaysPerMonth || 25;
  const dailyTarget = workingDaysPerMonth > 0 ? monthlyTarget / workingDaysPerMonth : 0;

  // Same completed-job-type counting as Profitability's all-time
  // breakdown, plus the same thing scoped to just the current month —
  // both live here too since Forecast is where "are we on track" gets
  // checked day to day, not just on the Profitability tab.
  const jobTypeBreakdown = useMemo(() => jobTypeCompletionCounts(bookings, jobTypes), [bookings, jobTypes]);
  const currentMonthLabel = useMemo(() => new Date(`${todayISO().slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }), []);
  const jobTypeBreakdownThisMonth = useMemo(() => {
    const currentKey = todayISO().slice(0, 7);
    return jobTypeCompletionCounts(bookings.filter((b) => b.date && b.date.slice(0, 7) === currentKey), jobTypes);
  }, [bookings, jobTypes]);

  // What's already on the books for the current month and any future month
  // that already has bookings — every booking dated that month regardless
  // of price/collected status, tracked against the monthly target, so it's
  // visible whether a month is on track before it even arrives rather than
  // only finding out once jobs are done and collected (which the
  // completed-profit tables on the Profitability tab necessarily lag behind).
  const forecast = useMemo(() => {
    const currentKey = todayISO().slice(0, 7);
    const byMonth = {};
    bookings.forEach((b) => {
      if (!b.date) return;
      const key = b.date.slice(0, 7);
      if (key < currentKey) return;
      (byMonth[key] = byMonth[key] || []).push(b);
    });
    return Object.keys(byMonth).sort().map((key) => {
      const rows = byMonth[key];
      const jobValue = rows.reduce((sum, b) => sum + (b.jobValue || 0), 0);
      // Actually invoiced (a real Zoho invoice raised) vs still just booked
      // in — the gauge below splits on this rather than a flat "hit target
      // or not" colour, since a month can look fully booked while most of
      // that value hasn't actually been billed yet.
      const invoicedValue = rows.reduce((sum, b) => sum + (b.zohoInvoiceId ? (b.jobValue || 0) : 0), 0);
      const notInvoicedValue = jobValue - invoicedValue;
      const unpriced = rows.filter((b) => !(b.jobValue > 0)).length;
      const label = new Date(`${key}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      const pct = monthlyTarget > 0 ? Math.min(100, (jobValue / monthlyTarget) * 100) : 0;
      const invoicedPct = monthlyTarget > 0 ? Math.min(100, (invoicedValue / monthlyTarget) * 100) : 0;
      const notInvoicedPct = Math.max(0, pct - invoicedPct);
      return { key, label, isCurrent: key === currentKey, count: rows.length, jobValue, invoicedValue, notInvoicedValue, unpriced, pct, invoicedPct, notInvoicedPct };
    });
  }, [bookings, monthlyTarget]);

  // "Where are we up to today" — a fixed daily pace (monthly target spread
  // over a settings-configurable working-days assumption, not the real
  // weekday count for whichever month this happens to be, so the daily
  // number itself stays stable to work to) compared against how many
  // working days have actually elapsed so far this month (real Mon-Fri
  // count, same weekdayCount used for holidays), then both booked-in value
  // and actually-invoiced value are checked against that expected-by-today
  // figure — invoiced is the one that actually matters, booked is just an
  // early signal since it can include jobs not yet done or billed.
  const salesAnalysis = useMemo(() => {
    const today = todayISO();
    const monthStart = `${today.slice(0, 7)}-01`;
    const workingDaysElapsed = weekdayCount(monthStart, today);
    const expectedByToday = dailyTarget * workingDaysElapsed;
    const currentMonth = forecast.find((f) => f.isCurrent);
    return {
      workingDaysElapsed,
      expectedByToday,
      bookedValue: currentMonth?.jobValue || 0,
      invoicedValue: currentMonth?.invoicedValue || 0,
      bookedVsExpected: (currentMonth?.jobValue || 0) - expectedByToday,
      invoicedVsExpected: (currentMonth?.invoicedValue || 0) - expectedByToday,
    };
  }, [forecast, dailyTarget]);

  // Every booking anywhere, any date, with no price entered yet — can't
  // count toward the target above until it's costed, so these need
  // chasing rather than just silently sitting blank.
  const outstanding = useMemo(() => {
    return bookings
      .filter((b) => !(b.jobValue > 0))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [bookings]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {outstanding.length > 0 && (
        <div className="wb-panel" style={{ borderColor: "var(--red)" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: "var(--red)", display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={16} /> {outstanding.length} booking{outstanding.length !== 1 ? "s" : ""} still need a price
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
            None of these count toward the target below until they're priced.{onOpenBooking ? " Click one to open it on the Calendar tab." : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {outstanding.map((b) => (
              <div
                key={b.id}
                onClick={() => onOpenBooking?.(b)}
                style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 13, padding: "6px 10px", borderRadius: 6, background: "var(--panel2)", cursor: onOpenBooking ? "pointer" : "default" }}
              >
                <span>{fmtDate(b.date)} — {b.customerName || "Unnamed"} <span style={{ color: "var(--muted)" }}>{b.reg}</span></span>
                <span style={{ color: "var(--muted)" }}>{b.business}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
          <TrendingUp size={16} color="var(--amber)" /> Sales analysis — {currentMonthLabel} so far
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>
          £{monthlyTarget.toLocaleString("en-GB")} target over {workingDaysPerMonth} working days = £{dailyTarget.toFixed(0)}/day. {salesAnalysis.workingDaysElapsed} working day{salesAnalysis.workingDaysElapsed !== 1 ? "s" : ""} in so far → expected by today: £{salesAnalysis.expectedByToday.toFixed(0)}.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div style={{ background: "var(--panel2)", borderRadius: 8, padding: "14px 16px", border: "1px solid var(--line)" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 6 }}>Booked in</div>
            <div className="wh-mono" style={{ fontSize: 24, fontWeight: 800 }}>£{salesAnalysis.bookedValue.toFixed(0)}</div>
            <div style={{ fontSize: 12, marginTop: 4, color: salesAnalysis.bookedVsExpected >= 0 ? "var(--green)" : "var(--red)" }}>
              {salesAnalysis.bookedVsExpected >= 0 ? "▲" : "▼"} £{Math.abs(salesAnalysis.bookedVsExpected).toFixed(0)} {salesAnalysis.bookedVsExpected >= 0 ? "ahead of" : "behind"} pace
            </div>
          </div>
          <div style={{ background: "var(--panel2)", borderRadius: 8, padding: "14px 16px", border: "1px solid var(--green)" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--green)", marginBottom: 6, fontWeight: 700 }}>Invoiced (what counts)</div>
            <div className="wh-mono" style={{ fontSize: 24, fontWeight: 800, color: "var(--green)" }}>£{salesAnalysis.invoicedValue.toFixed(0)}</div>
            <div style={{ fontSize: 12, marginTop: 4, color: salesAnalysis.invoicedVsExpected >= 0 ? "var(--green)" : "var(--red)" }}>
              {salesAnalysis.invoicedVsExpected >= 0 ? "▲" : "▼"} £{Math.abs(salesAnalysis.invoicedVsExpected).toFixed(0)} {salesAnalysis.invoicedVsExpected >= 0 ? "ahead of" : "behind"} pace
            </div>
          </div>
        </div>
      </div>

      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <TrendingUp size={16} color="var(--amber)" /> Forecast vs £{monthlyTarget.toLocaleString("en-GB")} monthly target
        </div>
        {forecast.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing booked in from today onward yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {forecast.map((f) => (
              <div key={f.key}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{f.label}{f.isCurrent ? " (so far)" : ""}</div>
                  <div className="wh-mono" style={{ fontSize: 12 }}>
                    {f.count} job{f.count !== 1 ? "s" : ""} · £{f.jobValue.toFixed(2)} of £{monthlyTarget.toFixed(2)} ({f.pct.toFixed(0)}%)
                  </div>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: "var(--panel2)", overflow: "hidden", display: "flex" }}>
                  <div style={{ height: "100%", width: `${f.invoicedPct}%`, background: "var(--green)", transition: "width 0.2s" }} title={`Invoiced: £${f.invoicedValue.toFixed(2)}`} />
                  <div style={{ height: "100%", width: `${f.notInvoicedPct}%`, background: "var(--amber)", transition: "width 0.2s" }} title={`Booked, not yet invoiced: £${f.notInvoicedValue.toFixed(2)}`} />
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, display: "flex", gap: 12 }}>
                  <span style={{ color: "var(--green)" }}>● Invoiced £{f.invoicedValue.toFixed(2)}</span>
                  <span style={{ color: "var(--amber2)" }}>● Booked, not yet invoiced £{f.notInvoicedValue.toFixed(2)}</span>
                </div>
                {f.unpriced > 0 && (
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    {f.unpriced} of those {f.unpriced === 1 ? "hasn't" : "haven't"} had a price entered yet — total will climb once priced.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {jobTypeBreakdownThisMonth.length > 0 && (
        <div className="wb-panel">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Job types completed — {currentMonthLabel} so far</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
            {jobTypeBreakdownThisMonth.map(([name, count]) => (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, background: "var(--panel2)", borderRadius: 6, padding: "6px 10px" }}>
                <span>{name}</span>
                <span className="wh-mono" style={{ fontWeight: 700 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {jobTypeBreakdown.length > 0 && (
        <div className="wb-panel">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Job types completed (all-time)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
            {jobTypeBreakdown.map(([name, count]) => (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, background: "var(--panel2)", borderRadius: 6, padding: "6px 10px" }}>
                <span>{name}</span>
                <span className="wh-mono" style={{ fontWeight: 700 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Staff wages & efficiency — basic + weekend days, per person per month,
// plus one shared bonus pot for the whole team (Ernesto and Ervin are both
// full-time on the same basic wage and split the bonus pot equally for
// pay, rather than each having their own separately-tracked bonus count),
// against that month's gross profit (job value minus parts) to see wages
// as a share of margin. One month at a time rather than a table per
// historical month, since this is edited like a spreadsheet as the month
// goes rather than browsed after the fact.
function StaffWagesSection({ months, bonusRates, addBonusRate, updateBonusRate, updateBonusRateJobTypes, removeBonusRate, staffWages, upsertStaffWage, removeStaffWage, bookings, jobTypes }) {
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const monthRows = useMemo(() => staffWages.filter((w) => w.month === month), [staffWages, month]);

  // Ernesto and Ervin are both full-time on the same basic wage every
  // month — rather than Chris having to remember to click "Add person"
  // twice at the start of each new month, a month that has nobody on it
  // yet gets seeded with both automatically. Only fires once per month per
  // session (tracked below) so deliberately removing everyone from a month
  // doesn't just bring them straight back.
  const seededMonths = useRef(new Set());
  useEffect(() => {
    if (monthRows.length > 0 || seededMonths.current.has(month)) return;
    seededMonths.current.add(month);
    ["Ernesto", "Ervin"].forEach((name) => {
      upsertStaffWage({ id: uid("sw"), name, month, basic: DEFAULT_BASIC_WAGE, weekendFullDays: 0, weekendHalfDays: 0, bonusCounts: {} });
    });
  }, [month, monthRows.length, upsertStaffWage]);

  // Auto-derived from actually completed + invoiced bookings — see
  // computeBonusCounts — nobody has to remember to type a count in by hand,
  // and it updates itself the moment a job gets marked complete and
  // invoiced. One shared pot for the month, split equally across however
  // many people are on this month's list (normally the two full-time techs).
  const bonusCounts = useMemo(() => computeBonusCounts(bookings, bonusRates, month), [bookings, bonusRates, month]);
  const totalBonusPot = useMemo(() => bonusRates.reduce((sum, br) => sum + (bonusCounts[br.id] || 0) * br.rate, 0), [bonusRates, bonusCounts]);
  const bonusPerPerson = monthRows.length > 0 ? totalBonusPot / monthRows.length : 0;

  const rowTotal = (w) => (w.basic || 0) + (w.weekendFullDays || 0) * WEEKEND_FULL_DAY_RATE + (w.weekendHalfDays || 0) * WEEKEND_HALF_DAY_RATE + bonusPerPerson;

  const totalOutlay = monthRows.reduce((sum, w) => sum + rowTotal(w), 0);
  const monthTotals = months.monthList.find((m) => m.key === month)?.totals;
  const grossMinusParts = monthTotals ? monthTotals.jobValue - monthTotals.partsCost : 0;
  const pct = grossMinusParts > 0 ? (totalOutlay / grossMinusParts) * 100 : null;

  const addPerson = () => {
    const name = prompt("Name:");
    if (!name || !name.trim()) return;
    if (monthRows.some((w) => w.name.toLowerCase() === name.trim().toLowerCase())) { alert(`${name.trim()} is already on this month's list.`); return; }
    upsertStaffWage({ id: uid("sw"), name: name.trim(), month, basic: DEFAULT_BASIC_WAGE, weekendFullDays: 0, weekendHalfDays: 0, bonusCounts: {} });
  };

  const patch = (w, fields) => upsertStaffWage({ ...w, ...fields });

  const addBonusType = () => {
    const name = prompt("Bonus job name (e.g. Turbo):");
    if (!name || !name.trim()) return;
    const rateStr = prompt(`£ bonus per ${name.trim()}:`, "50");
    const rate = parseFloat(rateStr);
    if (!rate || rate < 0) return;
    addBonusRate(name.trim(), rate);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="wb-panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}><User size={16} color="var(--amber)" /> Staff wages & efficiency</div>
          <input type="month" className="wb-input" style={{ maxWidth: 160 }} value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="wb-table">
            <thead>
              <tr>
                <th>Name</th><th>Basic £</th><th>Weekend full days</th><th>Weekend half days</th><th>Bonus share</th>
                <th>Total £</th><th></th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((w) => (
                <tr key={w.id}>
                  <td style={{ fontWeight: 600 }}>{w.name}</td>
                  <td><input type="number" className="wb-input" style={{ width: 80 }} value={w.basic} onChange={(e) => patch(w, { basic: parseFloat(e.target.value) || 0 })} /></td>
                  <td><input type="number" className="wb-input" style={{ width: 60 }} value={w.weekendFullDays} onChange={(e) => patch(w, { weekendFullDays: parseFloat(e.target.value) || 0 })} /></td>
                  <td><input type="number" className="wb-input" style={{ width: 60 }} value={w.weekendHalfDays} onChange={(e) => patch(w, { weekendHalfDays: parseFloat(e.target.value) || 0 })} /></td>
                  <td className="wh-mono" style={{ color: "var(--green)" }}>£{bonusPerPerson.toFixed(2)}</td>
                  <td className="wh-mono" style={{ fontWeight: 700 }}>£{rowTotal(w).toFixed(2)}</td>
                  <td><button onClick={() => removeStaffWage(w.id)} title="Remove" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button></td>
                </tr>
              ))}
              {monthRows.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Nobody added for this month yet.</td></tr>
              )}
            </tbody>
            {monthRows.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={4}>Total wage outlay</td>
                  <td colSpan={2} className="wh-mono">£{totalOutlay.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <button className="wb-btn-ghost" style={{ marginTop: 10 }} onClick={addPerson}><Plus size={13} /> Add person</button>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          {monthTotals ? (
            <div className="wh-mono" style={{ fontSize: 13, color: pct !== null && pct > 100 ? "var(--red)" : "var(--green)" }}>
              £{totalOutlay.toFixed(2)} wages is {pct !== null ? `${pct.toFixed(1)}%` : "—"} of £{grossMinusParts.toFixed(2)} gross profit (job value minus parts) for this month.
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No completed, priced jobs for this month yet, so there's no gross profit to compare wages against.</div>
          )}
        </div>
      </div>

      <div className="wb-panel" style={{ borderColor: "var(--green)" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
          <PoundSterling size={18} color="var(--green)" /> Team bonus pot — {new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
          Fed automatically from jobs completed and invoiced this month — nothing to type in.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          {bonusRates.map((br) => {
            const count = bonusCounts[br.id] || 0;
            const subtotal = count * br.rate;
            return (
              <div key={br.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 16, padding: "10px 14px", background: "var(--panel2)", borderRadius: 8 }}>
                <div>{br.name} <span style={{ color: "var(--muted)", fontSize: 13 }}>({count} × £{br.rate})</span></div>
                <div className="wh-mono" style={{ fontWeight: 700 }}>£{subtotal.toFixed(2)}</div>
              </div>
            );
          })}
          {bonusRates.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No bonus types set up yet.</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <div style={{ background: "#10281a", border: "1px solid var(--green)", borderRadius: 10, padding: "18px 20px" }}>
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--green)", marginBottom: 6, fontWeight: 700 }}>Total bonus pot</div>
            <div className="wh-mono" style={{ fontSize: 32, fontWeight: 800, color: "var(--green)" }}>£{totalBonusPot.toFixed(2)}</div>
          </div>
          <div style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10, padding: "18px 20px" }}>
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 6, fontWeight: 700 }}>
              Split {monthRows.length || 0} way{monthRows.length === 1 ? "" : "s"}
            </div>
            <div className="wh-mono" style={{ fontSize: 32, fontWeight: 800 }}>£{bonusPerPerson.toFixed(2)}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>per person, added to wages above</div>
          </div>
        </div>
      </div>

      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Bonus rates</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>£ per job, and which job types earn it — shared across every month, drives the auto-fed pot above.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 10 }}>
          {bonusRates.map((br) => (
            <div key={br.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, background: "var(--panel2)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 32px", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{br.name}</div>
                <input type="number" step="0.01" className="wb-input" value={br.rate} onChange={(e) => updateBonusRate(br.id, parseFloat(e.target.value) || 0)} />
                <button onClick={() => removeBonusRate(br.id)} title="Delete bonus type" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button>
              </div>
              <label className="wb-label">Counts for these job types</label>
              {(br.jobTypeIds || []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {br.jobTypeIds.map((id) => {
                    const jt = jobTypes.find((j) => j.id === id);
                    return (
                      <span key={id} className="wb-chip" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 0 }}>
                        {jt?.name || id}
                        <X size={11} style={{ cursor: "pointer" }} onClick={() => updateBonusRateJobTypes(br.id, br.jobTypeIds.filter((x) => x !== id))} />
                      </span>
                    );
                  })}
                </div>
              )}
              <select
                className="wb-select" value=""
                onChange={(e) => { if (e.target.value) updateBonusRateJobTypes(br.id, [...(br.jobTypeIds || []), e.target.value]); }}
              >
                <option value="">+ Add job type…</option>
                {jobTypes.filter((jt) => !(br.jobTypeIds || []).includes(jt.id)).map((jt) => <option key={jt.id} value={jt.id}>{jt.name}</option>)}
              </select>
            </div>
          ))}
          {bonusRates.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No bonus types set up yet.</div>}
        </div>
        <button className="wb-btn-ghost" onClick={addBonusType}><Plus size={13} /> Add bonus type</button>
      </div>
    </div>
  );
}

function ProfitabilityTab({ bookings, jobTypes, parts, settings, bonusRates, addBonusRate, updateBonusRate, updateBonusRateJobTypes, removeBonusRate, staffWages, upsertStaffWage, removeStaffWage, fixedCosts, addFixedCost, updateFixedCost, removeFixedCost }) {
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
      // Same main+extra job type counting as the all-time breakdown below,
      // just scoped to this one month — this is the number that actually
      // matches a staff bonus period, not the all-time total.
      const jobTypeCounts = {};
      rows.forEach((r) => {
        const ids = [r.booking.jobTypeId, ...(r.booking.extraJobTypeIds || [])].filter(Boolean);
        ids.forEach((id) => {
          const name = jobTypes.find((j) => j.id === id)?.name || "Unknown job type";
          jobTypeCounts[name] = (jobTypeCounts[name] || 0) + 1;
        });
      });
      const jobTypeBreakdown = Object.entries(jobTypeCounts).sort((a, b) => b[1] - a[1]);
      return { key, label, rows, totals, jobTypeBreakdown };
    });
    return { monthList, unpricedCount, notYetCompleteCount };
  }, [bookings, jobTypes, parts, settings]);

  // Which month's full breakdown is showing — one at a time behind a row of
  // month buttons, rather than every month's table stacked and expanded at
  // once, which just got longer and harder to actually use the more history
  // built up. Defaults to the most recent month with anything in it.
  const [selectedMonthKey, setSelectedMonthKey] = useState(null);
  const activeMonth = months.monthList.find((m) => m.key === selectedMonthKey) || months.monthList[0] || null;

  const grandTotal = months.monthList.reduce((acc, m) => ({
    jobValue: acc.jobValue + m.totals.jobValue, partsCost: acc.partsCost + m.totals.partsCost,
    labourCost: acc.labourCost + m.totals.labourCost, transportCost: acc.transportCost + m.totals.transportCost,
    profit: acc.profit + m.totals.profit,
  }), { jobValue: 0, partsCost: 0, labourCost: 0, transportCost: 0, profit: 0 });

  // All-time, across every month — see jobTypeCompletionCounts above.
  const jobTypeBreakdown = useMemo(() => jobTypeCompletionCounts(bookings, jobTypes), [bookings, jobTypes]);

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
        {months.monthList.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            {months.monthList.map((m) => (
              <button
                key={m.key}
                onClick={() => setSelectedMonthKey(m.key)}
                className={m.key === activeMonth?.key ? "wb-btn" : "wb-btn-ghost"}
                style={{ width: "auto", padding: "8px 16px" }}
              >
                {new Date(`${m.key}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
              </button>
            ))}
          </div>
        )}
      </div>

      <StaffWagesSection
        months={months} bonusRates={bonusRates} addBonusRate={addBonusRate} updateBonusRate={updateBonusRate} updateBonusRateJobTypes={updateBonusRateJobTypes} removeBonusRate={removeBonusRate}
        staffWages={staffWages} upsertStaffWage={upsertStaffWage} removeStaffWage={removeStaffWage}
        bookings={bookings} jobTypes={jobTypes}
      />

      <FixedCostsSection
        fixedCosts={fixedCosts} addFixedCost={addFixedCost} updateFixedCost={updateFixedCost} removeFixedCost={removeFixedCost}
        latestMonth={months.monthList[0] || null}
      />

      {jobTypeBreakdown.length > 0 && (
        <div className="wb-panel">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Job types completed (all-time)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
            {jobTypeBreakdown.map(([name, count]) => (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, background: "var(--panel2)", borderRadius: 6, padding: "6px 10px" }}>
                <span>{name}</span>
                <span className="wh-mono" style={{ fontWeight: 700 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {months.monthList.length === 0 && (
        <div className="wb-panel" style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "30px 0" }}>
          No priced jobs yet. Add a job value to a booking on the Calendar tab to see it here.
        </div>
      )}

      {activeMonth && (
        <div className="wb-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{activeMonth.label}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{activeMonth.rows.length} job{activeMonth.rows.length !== 1 ? "s" : ""}</div>
          </div>
          {activeMonth.jobTypeBreakdown.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6, marginBottom: 12 }}>
              {activeMonth.jobTypeBreakdown.map(([name, count]) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, background: "var(--panel2)", borderRadius: 6, padding: "5px 8px" }}>
                  <span>{name}</span>
                  <span className="wh-mono" style={{ fontWeight: 700 }}>{count}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="wb-table">
              <thead><tr><th>Date</th><th>Days</th><th>Customer</th><th>Reg</th><th>Job type</th><th>Invoiced</th><th>Quoted</th><th>Parts cost</th><th>Labour</th><th>Transport</th><th>Profit</th></tr></thead>
              <tbody>
                {activeMonth.rows.map((r) => (
                  <tr key={r.booking.id}>
                    <td className="wh-mono">{r.booking.date}</td>
                    <td className="wh-mono">{r.booking.days || 1}</td>
                    <td>{r.booking.customerName || "Unnamed"}</td>
                    <td className="wh-mono">{r.booking.reg}</td>
                    <td>{r.jt?.name || "—"}</td>
                    <td style={{ color: r.booking.zohoInvoiceId ? "var(--green)" : "var(--muted)", fontWeight: r.booking.zohoInvoiceId ? 700 : 400 }}>
                      {r.booking.zohoInvoiceId ? "Yes" : "No"}
                    </td>
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
                  <td colSpan={6}>Total</td>
                  <td className="wh-mono">£{activeMonth.totals.jobValue.toFixed(2)}</td>
                  <td className="wh-mono">£{activeMonth.totals.partsCost.toFixed(2)}</td>
                  <td className="wh-mono">£{activeMonth.totals.labourCost.toFixed(2)}</td>
                  <td className="wh-mono">£{activeMonth.totals.transportCost.toFixed(2)}</td>
                  <td className="wh-mono" style={{ color: activeMonth.totals.profit >= 0 ? "var(--green)" : "var(--red)" }}>£{activeMonth.totals.profit.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {(() => {
            // GP here is the same "job value minus parts" figure the wages
            // % already compares against above — one consistent definition
            // of gross profit used everywhere on this tab, not a second one.
            const gp = activeMonth.totals.jobValue - activeMonth.totals.partsCost;
            const pct = (v) => (gp > 0 ? `${((v / gp) * 100).toFixed(1)}% of GP` : "—");
            return (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Gross profit (quoted − parts)</span>
                  <span className="wh-mono" style={{ fontWeight: 700 }}>£{gp.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
                  <span>Parts cost</span>
                  <span className="wh-mono">£{activeMonth.totals.partsCost.toFixed(2)} ({pct(activeMonth.totals.partsCost)})</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
                  <span>Transport cost</span>
                  <span className="wh-mono">£{activeMonth.totals.transportCost.toFixed(2)} ({pct(activeMonth.totals.transportCost)})</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
                  <span>Non-productives</span>
                  <span className="wh-mono">£{settings.nonProductivesCost.toFixed(2)} ({pct(settings.nonProductivesCost)})</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// Standing monthly overheads — rent, insurance, subscriptions etc — kept as
// a maintainable list (add/rename/delete, like Bonus rates above) rather
// than a fixed set of fields, so the list can grow or change without a
// schema change every time. Not tied to a particular month since these
// rarely change; the % shown is against the most recent month's gross
// profit purely for a sense of scale.
function FixedCostsSection({ fixedCosts, addFixedCost, updateFixedCost, removeFixedCost, latestMonth }) {
  const total = fixedCosts.reduce((sum, f) => sum + (f.amount || 0), 0);
  const gp = latestMonth ? latestMonth.totals.jobValue - latestMonth.totals.partsCost : 0;
  const pct = latestMonth && gp > 0 ? (total / gp) * 100 : null;

  const addCost = () => {
    const name = prompt("Fixed cost name (e.g. Rent):");
    if (!name || !name.trim()) return;
    addFixedCost(name.trim(), 0);
  };
  const renameCost = (f) => {
    const name = prompt("Rename:", f.name);
    if (!name || !name.trim()) return;
    updateFixedCost(f.id, { name: name.trim() });
  };

  return (
    <div className="wb-panel">
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>True fixed costs</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
        Standing monthly overheads — add, rename or delete to build a true picture of what it costs to run the business each month.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        {fixedCosts.map((f) => (
          <div key={f.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 32px 32px", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 13 }}>{f.name}</div>
            <input type="number" step="0.01" className="wb-input" value={f.amount} onChange={(e) => updateFixedCost(f.id, { amount: parseFloat(e.target.value) || 0 })} />
            <button onClick={() => renameCost(f)} title="Rename" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><PenLine size={13} /></button>
            <button onClick={() => removeFixedCost(f.id)} title="Delete" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button>
          </div>
        ))}
        {fixedCosts.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No fixed costs set up yet.</div>}
      </div>
      <button className="wb-btn-ghost" onClick={addCost}><Plus size={13} /> Add fixed cost</button>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        <div className="wh-mono" style={{ fontSize: 13, fontWeight: 700 }}>Total fixed costs: £{total.toFixed(2)} / month</div>
        {latestMonth ? (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {pct !== null ? `${pct.toFixed(1)}%` : "—"} of £{gp.toFixed(2)} gross profit for {latestMonth.label}.
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>No completed, priced jobs yet to compare against.</div>
        )}
      </div>
    </div>
  );
}

// One collapsible row for a part — pulled out of StockTab because a part
// with job types in more than one brand now renders once per brand section
// it belongs to (per the "show it under every brand that uses it" choice),
// so this markup needs to be instantiable more than once per part.
function StockPartRow({ r, open, onToggle, pendingByPart, daysAgo, renamePart, setHistoryPart, updatePartField, orderAmounts, setOrderAmounts, orderStock, receiveAmounts, setReceiveAmounts, receiveStock, deliverStock, cancelOrder, amendOrder, deletePartClick, addAuditLog }) {
  const [editingBatchId, setEditingBatchId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const startEdit = (b) => { setEditingBatchId(b.id); setEditDraft({ qty: b.qtyOrdered, price: b.price, supplier: b.supplier || "" }); };
  const saveEdit = (b) => {
    const qty = parseFloat(editDraft.qty), price = parseFloat(editDraft.price);
    if (!qty || qty <= 0 || !price || price < 0) return;
    const reason = promptReason(`Why is the order for ${r.name} (${b.qtyOrdered} @ £${b.price.toFixed(2)}) being changed?`);
    if (reason === null) return;
    const changes = [];
    if (qty !== b.qtyOrdered) changes.push(`qty ${b.qtyOrdered}→${qty}`);
    if (price !== b.price) changes.push(`price £${b.price.toFixed(2)}→£${price.toFixed(2)}`);
    const supplier = editDraft.supplier.trim();
    if (supplier !== (b.supplier || "")) changes.push(`supplier ${b.supplier || "—"}→${supplier || "—"}`);
    amendOrder(b.id, { qty, price, supplier });
    if (changes.length > 0) addAuditLog(`Order amended: ${r.name} (${changes.join(", ")})`, reason);
    setEditingBatchId(null);
  };
  return (
    <React.Fragment>
      <tr style={{ cursor: "pointer" }} onClick={() => onToggle(r.id)}>
        <td style={{ width: 20 }}><ChevronDown size={14} style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.1s" }} /></td>
        <td style={{ fontWeight: 600 }}>
          {r.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({r.unit})</span>
          <button onClick={(e) => { e.stopPropagation(); renamePart(r); }} title="Rename part" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", marginLeft: 6, verticalAlign: "middle" }}><PenLine size={12} /></button>
          <a
            href={`https://octanedistribution.com/search.cfm?q=${encodeURIComponent(r.partNumber || r.name)}`}
            target="_blank" rel="noreferrer" title="Search on Octane Distribution"
            onClick={(e) => e.stopPropagation()}
            style={{ color: "var(--muted)", marginLeft: 6, verticalAlign: "middle", display: "inline-flex" }}
          >
            <Truck size={12} />
          </a>
        </td>
        <td className="wh-mono">
          {r.committed > 0 ? (
            <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "nowrap" }}>
              <div>Stock: {r.stock}</div>
              {r.onOrder > 0 && <div>On order: {r.onOrder}</div>}
              <div>Booked: {r.committed}</div>
              <div style={{ fontWeight: 700, color: r.availableAfterUpcoming < 0 ? "var(--red)" : "inherit" }}>
                {r.availableAfterUpcoming < 0 && <AlertTriangle size={10} style={{ display: "inline", marginRight: 2 }} />}
                Remaining: {r.availableAfterUpcoming}
              </div>
            </div>
          ) : r.stock}
        </td>
        <td className="wh-mono">{r.weekly ? r.weekly.toFixed(1) : "0.0"}</td>
        <td className="wh-mono">{r.weeksLeft === Infinity ? "—" : r.weeksLeft.toFixed(1)}</td>
        <td>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="wh-mono">£{(r.costPrice ?? 0).toFixed(2)}</span>
            <button onClick={(e) => { e.stopPropagation(); setHistoryPart(r); }} title="Price history" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><History size={14} /></button>
          </div>
        </td>
        <td>{r.needsOrder ? <span className="wb-badge-low"><AlertTriangle size={10} style={{ display: "inline", marginRight: 3 }} />Reorder</span> : <span className="wb-badge-ok"><Check size={10} style={{ display: "inline", marginRight: 3 }} />OK</span>}</td>
      </tr>
      {open && (
        <tr>
          <td></td>
          <td colSpan={6}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: "10px 0" }}>
              <div>
                <div className="jc-label" style={{ marginBottom: 4 }}>Part no.</div>
                <input
                  type="text" className="wb-input" style={{ width: 110 }} placeholder="e.g. LR073816" value={r.partNumber || ""}
                  onChange={(e) => updatePartField(r.id, { partNumber: e.target.value })}
                />
              </div>
              <div>
                <div className="jc-label" style={{ marginBottom: 4 }}>On order / due in</div>
                {(pendingByPart[r.id] || []).length === 0 ? (
                  <span style={{ color: "var(--muted)" }}>—</span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {pendingByPart[r.id].map((b) => {
                      const overdue = b.dueDate && b.dueDate < todayISO();
                      if (editingBatchId === b.id) {
                        return (
                          <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, flexWrap: "wrap" }}>
                            <input type="number" className="wb-input" style={{ width: 55 }} value={editDraft.qty} onChange={(e) => setEditDraft((prev) => ({ ...prev, qty: e.target.value }))} />
                            <input type="number" step="0.01" className="wb-input" style={{ width: 70 }} value={editDraft.price} onChange={(e) => setEditDraft((prev) => ({ ...prev, price: e.target.value }))} />
                            <input type="text" className="wb-input" style={{ width: 100 }} placeholder="Supplier" value={editDraft.supplier} onChange={(e) => setEditDraft((prev) => ({ ...prev, supplier: e.target.value }))} />
                            <button className="wb-btn-ghost" style={{ padding: "4px 8px", minHeight: 26, fontSize: 11, whiteSpace: "nowrap" }} onClick={() => saveEdit(b)}>Save</button>
                            <button className="wb-btn-ghost" style={{ padding: "4px 8px", minHeight: 26, fontSize: 11, whiteSpace: "nowrap" }} onClick={() => setEditingBatchId(null)}>Cancel</button>
                          </div>
                        );
                      }
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
                          <button className="wb-btn-ghost" style={{ padding: "4px 8px", minHeight: 26, fontSize: 11, whiteSpace: "nowrap" }} onClick={() => startEdit(b)}>
                            <PenLine size={11} style={{ display: "inline", marginRight: 3 }} />Amend
                          </button>
                          <button
                            className="wb-btn-ghost" style={{ padding: "4px 8px", minHeight: 26, fontSize: 11, whiteSpace: "nowrap", color: "var(--red)" }}
                            onClick={() => {
                              if (!confirm(`Cancel this order for ${b.qtyOrdered} @ £${b.price.toFixed(2)}${b.supplier ? ` from ${b.supplier}` : ""}? Use this when a supplier can't fulfil it after all.`)) return;
                              const reason = promptReason(`Why is this order for ${r.name} being cancelled?`);
                              if (reason === null) return;
                              cancelOrder(b.id);
                              addAuditLog(`Order cancelled: ${r.name} (${b.qtyOrdered} @ £${b.price.toFixed(2)}${b.supplier ? ` from ${b.supplier}` : ""})`, reason);
                            }}
                          >
                            <X size={11} style={{ display: "inline", marginRight: 3 }} />Cancel
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <div className="jc-label" style={{ marginBottom: 4 }}>Order stock</div>
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
              </div>
              <div>
                <div className="jc-label" style={{ marginBottom: 4 }}>Correct</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input type="number" className="wb-input" style={{ width: 60 }} placeholder="qty" value={receiveAmounts[r.id] || ""} onChange={(e) => setReceiveAmounts((prev) => ({ ...prev, [r.id]: e.target.value }))} />
                  <button
                    className="wb-btn-ghost" style={{ padding: "8px 10px", minHeight: 36, whiteSpace: "nowrap" }}
                    onClick={() => {
                      const qty = parseFloat(receiveAmounts[r.id]); if (!qty || qty <= 0) return;
                      const reason = promptReason(`Why are you adding ${qty} ${r.unit} of ${r.name} to stock?`);
                      if (reason === null) return;
                      receiveStock(r.id, qty);
                      addAuditLog(`Stock correction: ${r.name} +${qty}`, reason);
                      setReceiveAmounts((prev) => ({ ...prev, [r.id]: "" }));
                    }}
                  >Add</button>
                  <button
                    className="wb-btn-ghost" style={{ padding: "8px 10px", minHeight: 36, whiteSpace: "nowrap" }}
                    onClick={() => {
                      const qty = parseFloat(receiveAmounts[r.id]); if (!qty || qty <= 0) return;
                      const reason = promptReason(`Why are you removing ${qty} ${r.unit} of ${r.name} from stock?`);
                      if (reason === null) return;
                      receiveStock(r.id, -qty);
                      addAuditLog(`Stock correction: ${r.name} -${qty}`, reason);
                      setReceiveAmounts((prev) => ({ ...prev, [r.id]: "" }));
                    }}
                  >Remove</button>
                </div>
              </div>
              <div>
                <div className="jc-label" style={{ marginBottom: 4 }}>&nbsp;</div>
                <button onClick={() => setHistoryPart(r)} className="wb-btn-ghost" style={{ padding: "8px 10px", minHeight: 36, whiteSpace: "nowrap" }}><History size={14} style={{ display: "inline", marginRight: 4 }} />Price history</button>
              </div>
              <div>
                <div className="jc-label" style={{ marginBottom: 4 }}>&nbsp;</div>
                <button onClick={() => deletePartClick(r)} title="Delete part" className="wb-btn-ghost" style={{ padding: "8px 10px", minHeight: 36, color: "var(--red)" }}><X size={14} style={{ display: "inline", marginRight: 4 }} />Delete part</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

const STOCK_UNASSIGNED = "__unassigned__";

// Groups a set of part ids by brand — a part appears under every brand
// whose job type(s) use it (a generic oil filter used on both a Ford and a
// Nissan job appears in both sections), and anything not tied to a branded
// job type (or not on any recipe at all) falls into "Unassigned / other" so
// it's never invisible while brands are still being set up. Shared by Stock
// & Reorder and Suppliers so both tabs group parts identically.
function computeBrandSections(brands, jobTypes, allPartIds) {
  const partIdsByBrand = {};
  const usedPartIds = new Set();
  jobTypes.forEach((jt) => {
    const key = jt.brandId || STOCK_UNASSIGNED;
    jt.bom.forEach((l) => {
      usedPartIds.add(l.partId);
      (partIdsByBrand[key] || (partIdsByBrand[key] = new Set())).add(l.partId);
    });
  });
  const unassigned = new Set(partIdsByBrand[STOCK_UNASSIGNED] || []);
  allPartIds.forEach((id) => { if (!usedPartIds.has(id)) unassigned.add(id); });
  const list = brands.map((b) => ({ id: b.id, name: b.name, partIds: partIdsByBrand[b.id] || new Set() }));
  list.push({ id: STOCK_UNASSIGNED, name: "Unassigned / other", partIds: unassigned });
  return list;
}

// A small inline-editable text cell — click in, type a correction, tab or
// click away to save. Used for supplier names so a purchase can be relabelled
// once the real supplier is known, without a separate edit modal.
function EditableSupplierCell({ value, onSave }) {
  const [draft, setDraft] = useState(value || "");
  useEffect(() => { setDraft(value || ""); }, [value]);
  const commit = () => { if (draft.trim() !== (value || "")) onSave(draft.trim()); };
  return (
    <input
      className="wb-input" style={{ minWidth: 110, fontSize: 12, padding: "6px 8px" }}
      value={draft} placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
    />
  );
}

// Every recorded purchase, part first — pulled straight from price
// history rather than a new table, since every delivered stock order
// already logs itself there (deliverStock, above) alongside anything
// manually logged via the Price history modal, so this is already the
// complete, de-duplicated purchase record with no separate log to keep.
// Parts still on order (not yet delivered) are folded in too, shown in
// amber, so "who did we order this from" is answered even before it arrives.
function SuppliersTab({ priceHistory, parts, brands, jobTypes, stockBatches, updatePriceHistorySupplier, updateStockBatchSupplier }) {
  const [search, setSearch] = useState("");
  const [expandedBrands, setExpandedBrands] = useState(() => new Set());
  const toggleBrand = (id) => setExpandedBrands((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const partsIndex = useMemo(() => Object.fromEntries(parts.map((p) => [p.id, p])), [parts]);

  // Delivered purchases plus anything still on order — on-order rows carry
  // `onOrder: true` so they render in amber, since that stock isn't actually
  // here yet even though it's already committed to a supplier and a price.
  const rows = useMemo(() => {
    const delivered = priceHistory.map((h) => ({
      id: h.id, kind: "history", partId: h.partId, supplier: h.supplier, qty: h.qty, price: h.price, date: h.recordedAt, onOrder: false,
    }));
    const onOrder = stockBatches.filter((b) => b.status === "ordered").map((b) => ({
      id: b.id, kind: "batch", partId: b.partId, supplier: b.supplier, qty: b.qtyOrdered, price: b.price, date: b.orderedAt, onOrder: true,
    }));
    return [...delivered, ...onOrder]
      .map((r) => ({ ...r, part: partsIndex[r.partId] }))
      .filter((r) => r.part)
      .sort((a, b) => {
        if (a.part.name !== b.part.name) return a.part.name < b.part.name ? -1 : 1;
        return a.date < b.date ? 1 : -1;
      });
  }, [priceHistory, stockBatches, partsIndex]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.part.name.toLowerCase().includes(q) || (r.supplier || "").toLowerCase().includes(q));
  }, [rows, search]);

  // Grouped by brand (same grouping as Stock & Reorder) so a specific make's
  // suppliers are easy to find, rather than one long list across every part —
  // within a brand, parts stay in the existing alphabetical-then-newest-first order.
  const sections = useMemo(() => {
    const sectionDefs = computeBrandSections(brands, jobTypes, parts.map((p) => p.id));
    return sectionDefs
      .map((section) => ({ ...section, rows: filtered.filter((r) => section.partIds.has(r.partId)) }))
      .filter((section) => section.rows.length > 0);
  }, [brands, jobTypes, parts, filtered]);

  const saveSupplier = (r, value) => {
    if (r.kind === "history") updatePriceHistorySupplier(r.id, value || null);
    else updateStockBatchSupplier(r.id, value || null);
  };

  return (
    <div className="wb-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}><Truck size={16} color="var(--amber)" /> Suppliers</div>
        <input className="wb-input" style={{ maxWidth: 240 }} placeholder="Search part or supplier…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sections.map((section) => {
          const open = expandedBrands.has(section.id);
          return (
            <div key={section.id} className="wb-panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => toggleBrand(section.id)}>
                <ChevronDown size={14} style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.1s", color: "var(--muted)" }} />
                <div style={{ fontWeight: 700, fontSize: 14 }}>{section.name}</div>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>({section.rows.length})</span>
              </div>
              {open && (
                <div style={{ overflowX: "auto", marginTop: 10 }}>
                  <table className="wb-table">
                    <thead><tr><th>Part</th><th>Supplier</th><th>Qty</th><th>Price</th><th>Date</th><th></th></tr></thead>
                    <tbody>
                      {section.rows.map((r) => (
                        <tr key={`${r.kind}-${r.id}`}>
                          <td style={{ fontWeight: 600 }}>{r.part.name}</td>
                          <td><EditableSupplierCell value={r.supplier} onSave={(v) => saveSupplier(r, v)} /></td>
                          <td className="wh-mono" style={r.onOrder ? { color: "var(--amber2)" } : undefined}>{r.qty ?? "—"}</td>
                          <td className="wh-mono" style={r.onOrder ? { color: "var(--amber2)" } : undefined}>£{r.price.toFixed(2)}</td>
                          <td className="wh-mono" style={r.onOrder ? { color: "var(--amber2)" } : undefined}>{new Date(r.date).toLocaleDateString("en-GB")}</td>
                          <td>{r.onOrder && <span className="wb-chip" style={{ display: "inline-block" }}>On order</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {sections.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "30px 0" }}>No purchases recorded yet.</div>
        )}
      </div>
    </div>
  );
}

function StockTab({ stockRows, jobTypes, receiveStock, updatePartField, removePart, stockBatches, orderStock, deliverStock, cancelOrder, amendOrder, priceHistory, recordPrice, brands, addBrand, removeBrand, renameBrand, addAuditLog, onPrintOutstandingParts }) {
  const [receiveAmounts, setReceiveAmounts] = useState({});
  const [orderAmounts, setOrderAmounts] = useState({}); // { [partId]: { qty, price } }
  const [downloadingPartsPdf, setDownloadingPartsPdf] = useState(false);
  const [historyPart, setHistoryPart] = useState(null);
  const [priceCheckOpen, setPriceCheckOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set()); // per-part rows, shared across brand sections
  // Sections start collapsed too, same reasoning as Job Types and the
  // per-part rows above — several brands' worth of parts at once was right
  // back to being a wall of tables.
  const [expandedBrands, setExpandedBrands] = useState(() => new Set());
  const toggle = (id) => setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleBrand = (id) => setExpandedBrands((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
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

  // Downloads a PDF of every part on order but not yet delivered, soonest
  // due first — same list the print button sends to the reception printer,
  // just as a file that can be forwarded to a supplier or a technician.
  const downloadOutstandingPartsPdf = async () => {
    setDownloadingPartsPdf(true);
    try {
      const opRows = outstandingPartsRows(stockBatches, stockRows);
      const res = await fetch("/api/office/outstanding-parts-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: opRows, generatedAt: new Date().toISOString() }),
      });
      if (!res.ok) { alert("Failed to generate the PDF."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `outstanding-parts-${todayISO()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to generate the PDF — check your connection and try again.");
    }
    setDownloadingPartsPdf(false);
  };

  const sections = useMemo(() => computeBrandSections(brands, jobTypes, stockRows.map((r) => r.id)), [brands, jobTypes, stockRows]);

  const addBrandClick = () => { const name = prompt("New brand name:"); if (!name || !name.trim()) return; addBrand(name.trim()); };
  const renameBrandClick = (section) => { const name = prompt("Rename brand:", section.name); if (!name || !name.trim()) return; renameBrand(section.id, name.trim()); };
  const removeBrandClick = (section) => {
    const taggedJobTypes = jobTypes.filter((jt) => jt.brandId === section.id);
    const warning = taggedJobTypes.length
      ? `${taggedJobTypes.length} job type${taggedJobTypes.length === 1 ? "" : "s"} (${taggedJobTypes.map((jt) => jt.name).join(", ")}) ${taggedJobTypes.length === 1 ? "is" : "are"} tagged "${section.name}" — deleting it will set ${taggedJobTypes.length === 1 ? "that job type" : "those job types"} back to no brand, not delete them. `
      : "";
    if (!confirm(`${warning}Delete brand "${section.name}"?`)) return;
    removeBrand(section.id);
  };

  const rowProps = { pendingByPart, daysAgo, renamePart, setHistoryPart, updatePartField, orderAmounts, setOrderAmounts, orderStock, receiveAmounts, setReceiveAmounts, receiveStock, deliverStock, cancelOrder, amendOrder, deletePartClick, addAuditLog };

  return (
    <div className="wb-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}><Package size={16} color="var(--amber)" /> Stock levels</div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>Usage from last 28 days · flags when cover &lt; {REORDER_WEEKS} week</div>
        <button className="wb-btn-ghost" onClick={onPrintOutstandingParts} title="Print every part on order, soonest due first"><Printer size={13} /> Print outstanding parts</button>
        <button className="wb-btn-ghost" disabled={downloadingPartsPdf} style={downloadingPartsPdf ? { opacity: 0.5, cursor: "not-allowed" } : {}} onClick={downloadOutstandingPartsPdf} title="Download the same list as a PDF"><Download size={13} /> {downloadingPartsPdf ? "Generating…" : "Download PDF"}</button>
        <button className="wb-btn-ghost" onClick={exportPriceHistory} disabled={priceHistory.length === 0}><FileText size={13} /> Export price history</button>
        <button className="wb-btn-ghost" onClick={() => setPriceCheckOpen(true)}><Search size={13} /> Find cheapest price</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sections.map((section) => {
          const rows = stockRows.filter((r) => section.partIds.has(r.id));
          const brandOpen = expandedBrands.has(section.id);
          // A red brand name is a quick "something in here needs ordering"
          // signal without having to open every section to check.
          const hasShortage = rows.some((r) => r.needsOrder);
          return (
            <div key={section.id} className="wb-panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => toggleBrand(section.id)}>
                  <ChevronDown size={14} style={{ transform: brandOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.1s", color: "var(--muted)" }} />
                  <div style={{ fontWeight: 700, fontSize: 14, color: hasShortage ? "var(--red)" : undefined }}>{section.name}</div>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>({rows.length} part{rows.length === 1 ? "" : "s"})</span>
                </div>
                {section.id !== STOCK_UNASSIGNED && (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => renameBrandClick(section)} title="Rename brand" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><PenLine size={13} /></button>
                    <button onClick={() => removeBrandClick(section)} title="Delete brand" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button>
                  </div>
                )}
              </div>
              {brandOpen && (
                rows.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0 2px" }}>
                    No job types tagged with this brand yet — set a job type's brand on the Job Types tab.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto", marginTop: 10 }}>
                    <table className="wb-table">
                      <thead><tr><th></th><th>Part</th><th>Physical stock</th><th>Weekly usage</th><th>Weeks cover</th><th>Cost price</th><th>Status</th></tr></thead>
                      <tbody>
                        {rows.map((r) => (
                          <StockPartRow key={`${section.id}-${r.id}`} r={r} open={expanded.has(r.id)} onToggle={toggle} {...rowProps} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="wb-btn" onClick={addBrandClick}><Plus size={13} /> Add brand</button>
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

function JobTypesTab({ jobTypes, parts, bookings, addPart, addJobType, renameJobType, updateJobTypeColor, addBomLine, updateBomQty, removeBomLine, brands, updateJobTypeBrand, removeJobType, updateJobTypeStandardPrice }) {
  const [showNewJobType, setShowNewJobType] = useState(false);
  const addJobTypeClick = () => setShowNewJobType(true);
  const renameJobTypeClick = (jtId) => { const jt = jobTypes.find((j) => j.id === jtId); const name = prompt("Rename job type:", jt.name); if (!name) return; renameJobType(jtId, name); };
  // Unlike a part or a brand, a job type is directly wired into bookings —
  // bookings.job_type_id is "on delete set null", so deleting one still in
  // use would silently wipe which job was actually done off real customer
  // records. That's not a "warn and let them proceed" situation like
  // deleting a part; it's a hard block until nothing references it anymore.
  const removeJobTypeClick = (jt) => {
    const mainCount = bookings.filter((b) => b.jobTypeId === jt.id).length;
    const extraCount = bookings.filter((b) => (b.extraJobTypeIds || []).includes(jt.id)).length;
    if (mainCount + extraCount > 0) {
      alert(`Can't delete "${jt.name}" — it's used on ${mainCount + extraCount} booking${mainCount + extraCount === 1 ? "" : "s"} (${mainCount} as the main job${extraCount ? `, ${extraCount} as an extra job` : ""}). Rename it instead if you want to retire it, or remove it from those bookings first.`);
      return;
    }
    if (!confirm(`Delete "${jt.name}"${jt.bom.length ? ` and its ${jt.bom.length}-part recipe` : ""}? This can't be undone.`)) return;
    removeJobType(jt.id);
  };
  const addPartClick = () => { const name = prompt("New part name:"); if (!name) return; const unit = prompt("Unit (each / litre / kit):", "each") || "each"; addPart(name, unit); };
  // Collapsed by default — with a dozen-plus job types each showing their
  // full parts list, the tab was one long scroll of stuff that's already
  // set up and rarely needs touching. Expand just the one you're editing.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (id) => setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="wb-btn-ghost" onClick={addPartClick}><Plus size={13} /> New part</button>
        <button className="wb-btn" onClick={addJobTypeClick}><Plus size={13} /> New job type</button>
      </div>
      {jobTypes.map((jt) => {
        const open = expanded.has(jt.id);
        return (
        <div key={jt.id} className="wb-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: open ? 10 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => toggle(jt.id)}>
              <ChevronDown size={14} style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.1s", color: "var(--muted)" }} />
              <div style={{ fontWeight: 700, fontSize: 14 }}>{jt.name}</div>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>({jt.bom.length} part{jt.bom.length === 1 ? "" : "s"})</span>
              {!open && jt.brandId && (
                <span style={{ fontSize: 11, color: "var(--muted)" }}>· {brands.find((b) => b.id === jt.brandId)?.name || ""}</span>
              )}
              {!open && jt.standardPrice != null && (
                <span style={{ fontSize: 11, color: "var(--muted)" }}>· £{jt.standardPrice.toFixed(2)}</span>
              )}
              {!open && jt.publicBookable && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--green)", border: "1px solid var(--green)", borderRadius: 20, padding: "1px 7px" }}>Public</span>
              )}
            </div>
            {open && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Brand</span>
                <select
                  className="wb-select" style={{ maxWidth: 150 }} value={jt.brandId || ""}
                  onChange={(e) => updateJobTypeBrand(jt.id, e.target.value || null)}
                >
                  <option value="">No brand</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Standard price £</span>
                <input
                  type="number" step="0.01" className="wb-input" style={{ width: 90 }} placeholder="varies"
                  value={jt.standardPrice ?? ""}
                  onChange={(e) => updateJobTypeStandardPrice(jt.id, e.target.value === "" ? null : parseFloat(e.target.value) || 0)}
                />
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
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!jt.publicBookable} onChange={(e) => updateJobTypePublicBookable(jt.id, e.target.checked)} />
                  Show on public booking form
                </label>
                <button className="wb-btn-ghost" onClick={() => renameJobTypeClick(jt.id)}>Rename</button>
                <button onClick={() => removeJobTypeClick(jt)} title="Delete job type" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button>
              </div>
            )}
          </div>
          {open && (
            <>
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
            </>
          )}
        </div>
        );
      })}
      {showNewJobType && (
        <NewJobTypeModal
          brands={brands}
          onClose={() => setShowNewJobType(false)}
          onCreate={(name, brandId) => { addJobType(name, brandId); setShowNewJobType(false); }}
        />
      )}
    </div>
  );
}

function NewJobTypeModal({ brands, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [brandId, setBrandId] = useState("");
  const create = () => { if (!name.trim()) return; onCreate(name.trim(), brandId || null); };
  return (
    <div className="wb-modal-backdrop" onClick={onClose}>
      <div className="wb-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>New job type</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="wb-label">Name</label>
            <input className="wb-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} placeholder="e.g. Nissan Qashqai Cambelt Kit" />
          </div>
          <div>
            <label className="wb-label">Brand</label>
            <select className="wb-select" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">No brand</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button className="wb-btn" disabled={!name.trim()} style={!name.trim() ? { opacity: 0.5, cursor: "not-allowed" } : {}} onClick={create}>Create job type</button>
        </div>
      </div>
    </div>
  );
}

function HolidaysTab({ holidays, addHoliday, removeHoliday }) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const add = () => {
    if (!name.trim() || !from || !to) return;
    addHoliday(name.trim(), from, to < from ? from : to);
    setName(""); setFrom(""); setTo("");
  };

  const sorted = [...holidays].sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : 1));

  // Weekdays only per entry — a Sat-Sun either side of a booked week
  // doesn't cost a day, since nobody's rostered to work them anyway.
  const tally = useMemo(() => {
    const totals = {};
    holidays.forEach((h) => {
      totals[h.name] = (totals[h.name] || 0) + weekdayCount(h.dateFrom, h.dateTo);
    });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [holidays]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <Sun size={16} color="var(--amber)" /> Holidays
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end", marginBottom: 16 }}>
          <div><label className="wb-label">Name</label><input className="wb-input" style={{ width: 160 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chris" /></div>
          <div><label className="wb-label">From</label><input type="date" className="wb-input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="wb-label">To</label><input type="date" className="wb-input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="wb-btn" disabled={!name.trim() || !from || !to} style={!name.trim() || !from || !to ? { opacity: 0.5, cursor: "not-allowed" } : {}} onClick={add}>
            <Plus size={13} /> Add holiday
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="wb-table">
            <thead><tr><th>Name</th><th>From</th><th>To</th><th>Days (Mon-Fri)</th><th></th></tr></thead>
            <tbody>
              {sorted.map((h) => (
                <tr key={h.id}>
                  <td style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: holidayColor(h.name), display: "inline-block", flexShrink: 0 }} />
                    {h.name}
                  </td>
                  <td className="wh-mono">{fmtDate(h.dateFrom)}</td>
                  <td className="wh-mono">{fmtDate(h.dateTo)}</td>
                  <td className="wh-mono">{weekdayCount(h.dateFrom, h.dateTo)}</td>
                  <td><button onClick={() => removeHoliday(h.id)} title="Delete holiday" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button></td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No holidays booked in yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {tally.length > 0 && (
        <div className="wb-panel">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Total days per person (Mon-Fri only)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
            {tally.map(([person, days]) => (
              <div key={person} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, background: "var(--panel2)", borderRadius: 6, padding: "6px 10px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: holidayColor(person), display: "inline-block", flexShrink: 0 }} />
                  {person}
                </span>
                <span className="wh-mono" style={{ fontWeight: 700 }}>{days}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Requests submitted through the public /book form — the daily cap and
// week's-notice rule are already enforced before a request ever lands here,
// so everything visible has passed those checks; this is purely "does
// office want to accept it". A request whose requirements mention a chain
// job and lands within 2 days of another chain job's span gets a warning
// badge, since that's the one case worth a closer look even within capacity.
function BookingRequestsTab({ requests, jobTypes, bookings, holidays, onAccept, onDecline, onRefresh }) {
  const overlapsChainJob = (req) => {
    const isChainRequest = (req.requirements || []).some((r) => r.toLowerCase().includes("chain"));
    if (!isChainRequest) return false;
    return bookings.some((b) => {
      const jt = jobTypes.find((j) => j.id === b.jobTypeId);
      const extraJts = (b.extraJobTypeIds || []).map((id) => jobTypes.find((j) => j.id === id));
      if (!isTimingChainReplacement(jt) && !extraJts.some(isTimingChainReplacement)) return false;
      return bookingDates(b).some((d) => req.date >= addDaysISO(d, -2) && req.date <= addDaysISO(d, 2));
    });
  };

  // Both technicians off already stops the request ever reaching this list
  // (the public form refuses it outright — see /api/public/book) — so in
  // practice this only ever fires for the one-off case, cutting that day's
  // capacity to 2 rather than blocking it, worth a closer look.
  const TECHS = ["Ernesto", "Ervin"];
  const techsOffFor = (req) => {
    const off = new Set();
    holidays.forEach((h) => {
      if (req.date >= h.dateFrom && req.date <= h.dateTo) {
        TECHS.forEach((t) => { if (h.name.toLowerCase().includes(t.toLowerCase())) off.add(t); });
      }
    });
    return [...off];
  };

  return (
    <div className="wb-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
          <Inbox size={16} color="var(--amber)" /> Booking requests
        </div>
        <button className="wb-btn-ghost" style={{ padding: "6px 10px", minHeight: "auto" }} onClick={onRefresh}>Refresh</button>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>
        Submitted through the public booking page — accept to add it to the diary as a real booking, or decline it.
      </div>
      {requests.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "30px 0" }}>No pending requests.</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {requests.map((req) => {
          const chainWarn = overlapsChainJob(req);
          const techsOff = techsOffFor(req);
          const warn = chainWarn || techsOff.length > 0;
          return (
            <div key={req.id} className="wb-panel" style={{ padding: 12, ...(warn ? { borderColor: "var(--red)" } : {}) }}>
              {req.is_emergency && (
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--red)", display: "flex", alignItems: "center", gap: 4, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <AlertTriangle size={12} /> Emergency — call to confirm
                </div>
              )}
              {req.is_non_runner && (
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--red)", display: "flex", alignItems: "center", gap: 4, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <AlertTriangle size={12} /> Non-runner
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{req.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>— {req.business}</span></div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    {req.is_emergency ? (
                      <>1st choice {fmtDate(req.date)} · 2nd choice {req.second_date ? fmtDate(req.second_date) : "—"}</>
                    ) : (
                      fmtDate(req.date)
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  {chainWarn && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--red)", display: "flex", alignItems: "center", gap: 4 }}>
                      <AlertTriangle size={12} /> Close to another chain job
                    </div>
                  )}
                  {techsOff.length > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--red)", display: "flex", alignItems: "center", gap: 4 }}>
                      <AlertTriangle size={12} /> {techsOff.join(" & ")} on holiday that day
                    </div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
                {req.phone && <span><Phone size={10} style={{ display: "inline", marginRight: 4 }} />{req.phone}</span>}
                {req.email && <span><Mail size={10} style={{ display: "inline", marginRight: 4 }} />{req.email}</span>}
                {req.reg && <span><Car size={10} style={{ display: "inline", marginRight: 4 }} />{req.reg}</span>}
                {req.address && <span><MapPin size={10} style={{ display: "inline", marginRight: 4 }} />{req.address}</span>}
              </div>
              {req.symptoms && (
                <div style={{ marginTop: 8, fontSize: 12, background: "var(--panel2)", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap" }}>
                  <strong>Symptoms:</strong> {req.symptoms}
                </div>
              )}
              {req.other_details && (
                <div style={{ marginTop: 8, fontSize: 12, background: "var(--panel2)", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap" }}>
                  {req.other_details}
                </div>
              )}
              {(req.requirements || []).length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {req.requirements.map((r) => <span key={r} className="wb-chip" style={{ marginTop: 0 }}>{r}</span>)}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="wb-btn" style={{ padding: "8px 14px", minHeight: "auto" }} onClick={() => onAccept(req)}>Accept</button>
                <button className="wb-btn-ghost" style={{ padding: "8px 14px", minHeight: "auto", color: "var(--red)" }} onClick={() => onDecline(req)}>Decline</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Every stock correction, order amendment, or cancelled order — and the
// reason given for it — so if a figure looks wrong later there's a record
// of what changed and why, rather than a silent edit. Read-only here; the
// entries themselves are written by the actions that trigger them (Stock
// tab's Correct/Cancel/order-edit controls), each gated on promptReason.
function AuditLogTab({ auditLog }) {
  return (
    <div className="wb-panel">
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
        <History size={16} color="var(--amber)" /> Corrections & deletions
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>
        Every stock correction, order amendment, or cancelled order requires a reason — this is the record of what changed and why.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="wb-table">
          <thead><tr><th>Date</th><th>What changed</th><th>Reason given</th></tr></thead>
          <tbody>
            {auditLog.map((a) => (
              <tr key={a.id}>
                <td className="wh-mono" style={{ whiteSpace: "nowrap" }}>{new Date(a.createdAt).toLocaleString("en-GB")}</td>
                <td>{a.summary}</td>
                <td>{a.reason}</td>
              </tr>
            ))}
            {auditLog.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No corrections or deletions logged yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
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
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Monthly target</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>Gross invoice sales target per month — shown as progress on the Profitability tab, and drives the daily pace target on the Forecast tab.</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div><label className="wb-label">Target £ per month</label><input type="number" step="100" className="wb-input" style={{ maxWidth: 160 }} value={settings.monthlyTarget} onChange={(e) => updateSettingsField({ monthlyTarget: parseFloat(e.target.value) || 0 })} /></div>
          <div><label className="wb-label">Working days per month</label><input type="number" step="1" className="wb-input" style={{ maxWidth: 160 }} value={settings.workingDaysPerMonth} onChange={(e) => updateSettingsField({ workingDaysPerMonth: parseFloat(e.target.value) || 0 })} /></div>
        </div>
      </div>
      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Non-productives cost</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>Monthly cost of non-productive time — shown as a deduction against gross profit on the Profitability tab.</div>
        <div><label className="wb-label">£ per month</label><input type="number" step="100" className="wb-input" style={{ maxWidth: 160 }} value={settings.nonProductivesCost} onChange={(e) => updateSettingsField({ nonProductivesCost: parseFloat(e.target.value) || 0 })} /></div>
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

// initialValues prefills a brand-new booking (e.g. from an accepted public
// booking request) without treating it as an edit of an existing one — kept
// separate from `booking` so onSave/the "Save changes" vs "Save booking"
// label still key off whether this is a genuine edit.
function NewBookingModal({ jobTypes, parts, settings, brands, defaultDate, booking, initialValues, onClose, onSave }) {
  const partsIndex = useMemo(() => Object.fromEntries(parts.map((p) => [p.id, p.name])), [parts]);
  const [pasteText, setPasteText] = useState("");
  const [customerName, setCustomerName] = useState(booking?.customerName || initialValues?.customerName || "");
  const [phone, setPhone] = useState(booking?.phone || initialValues?.phone || "");
  const [email, setEmail] = useState(booking?.email || initialValues?.email || "");
  const [reg, setReg] = useState(booking?.reg || initialValues?.reg || "");
  const [beltChainStatus, setBeltChainStatus] = useState("idle"); // idle | loading | done | error
  const [beltChainResult, setBeltChainResult] = useState(null);
  const [beltChainError, setBeltChainError] = useState("");
  const [symptoms, setSymptoms] = useState(booking?.symptoms || initialValues?.symptoms || "");
  const [business, setBusiness] = useState(booking?.business || initialValues?.business || BUSINESSES[0]);
  const [jobTypeId, setJobTypeId] = useState(booking?.jobTypeId || initialValues?.jobTypeId || jobTypes[0]?.id || "");
  const [extraJobTypeIds, setExtraJobTypeIds] = useState(booking?.extraJobTypeIds || []);
  const [extraParts, setExtraParts] = useState(booking?.extraParts || []);
  const [bomQtyOverrides, setBomQtyOverrides] = useState(booking?.bomQtyOverrides || []);
  // Make/model used to be one free-text field; split into a Make dropdown
  // (driven by the brands list, so it grows as new makes are taken on) and
  // a free-text Model, then recombined into the same "Make Model" string
  // the rest of the app already expects (thermostat lookup, job card
  // auto-fill via guessMakeModel) — no schema change needed. A make from an
  // existing booking that doesn't match a current brand name exactly (e.g.
  // spacing) falls back to "Other" with the original text preserved.
  const guessedVehicle = useMemo(() => guessMakeModel(booking?.vehicleModel), [booking?.vehicleModel]);
  const matchedBrand = brands.find((b) => b.name.replace(/\s+/g, "").toLowerCase() === guessedVehicle.make.replace(/\s+/g, "").toLowerCase());
  const [vehicleMake, setVehicleMake] = useState(matchedBrand ? matchedBrand.name : guessedVehicle.make ? "Other" : "");
  const [vehicleMakeOther, setVehicleMakeOther] = useState(matchedBrand ? "" : guessedVehicle.make);
  const [vehicleModelText, setVehicleModelText] = useState(guessedVehicle.model);
  const vehicleModel = [vehicleMake === "Other" ? vehicleMakeOther.trim() : vehicleMake, vehicleModelText.trim()].filter(Boolean).join(" ").trim();
  const [date, setDate] = useState(booking?.date || initialValues?.date || defaultDate);
  const [days, setDays] = useState(booking?.days || 1);
  // Once staff manually type a days figure, the auto-default below stops
  // touching it — otherwise picking a second job type after correcting the
  // first would silently overwrite their correction.
  const [daysTouched, setDaysTouched] = useState(false);
  const [pickupRequired, setPickupRequired] = useState(booking?.pickupRequired || false);
  const [pickupAddress, setPickupAddress] = useState(booking?.pickupAddress || initialValues?.pickupAddress || "");
  const [postcode, setPostcode] = useState(booking?.postcode || "");
  const [distanceMiles, setDistanceMiles] = useState(booking?.distanceMiles ?? null);
  const [paymentMethod, setPaymentMethod] = useState(booking?.paymentMethod || "");
  // Price per job type on this booking (main + each extra), keyed by job
  // type id — summed into the invoice total below. An existing booking with
  // no breakdown saved yet (from before this existed) falls back to putting
  // its whole current total on the main job type, rather than losing it.
  const [jobTypePrices, setJobTypePrices] = useState(() => {
    if (booking?.jobTypePrices?.length) return Object.fromEntries(booking.jobTypePrices.map((p) => [p.jobTypeId, p.price]));
    if (booking) return { [booking.jobTypeId]: booking.jobValue || 0 };
    return {};
  });
  // Pre-fills a job type's standard price (set on the Job Types tab) the
  // moment that job type is picked (main or extra) on a new booking —
  // preserves whatever was already typed for a job type if it's picked
  // again, and never touches an existing booking's already-agreed prices
  // when editing. Falls back to the legacy Timing Chain Replacement price
  // for that one job type if it hasn't been given a standard price yet.
  const priceForNewJobType = (id) => {
    const jt = jobTypes.find((j) => j.id === id);
    if (jt?.standardPrice != null) return jt.standardPrice;
    return isTimingChainReplacement(jt) ? STANDARD_TIMING_CHAIN_PRICE.jobValue : 0;
  };
  useEffect(() => {
    if (booking) return;
    setJobTypePrices((prev) => (jobTypeId in prev ? prev : { ...prev, [jobTypeId]: priceForNewJobType(jobTypeId) }));
  }, [jobTypeId]);
  // Same idea, for how many days the job normally takes — see
  // defaultDaysForJobType above for which brand/job combos this covers.
  useEffect(() => {
    if (booking || daysTouched) return;
    const def = defaultDaysForJobType(jobTypes.find((j) => j.id === jobTypeId), brands);
    if (def) setDays(def);
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

  // Looks the reg up via /api/office/belt-or-chain (DVSA MOT History API +
  // our curated engine list) — see belt-or-chain/README.md for the standalone
  // CLI version this was ported from. Never invents a part number: an engine
  // not yet in the list comes back as "no match", not a guess.
  const checkBeltOrChain = async () => {
    if (!reg.trim()) return;
    setBeltChainStatus("loading");
    setBeltChainError("");
    setBeltChainResult(null);
    try {
      const res = await fetch("/api/office/belt-or-chain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      setBeltChainResult(data);
      setBeltChainStatus("done");
    } catch (e) {
      setBeltChainError(e.message);
      setBeltChainStatus("error");
    }
  };

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
            <div>
              <label className="wb-label">Vehicle registration</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="wb-input" style={{ flex: 1 }} value={reg} onChange={(e) => setReg(e.target.value.toUpperCase())} />
                <button type="button" className="wb-btn-ghost" style={{ whiteSpace: "nowrap" }} onClick={checkBeltOrChain} disabled={!reg.trim() || beltChainStatus === "loading"}>
                  <Wrench size={12} /> {beltChainStatus === "loading" ? "Checking…" : "Belt/chain?"}
                </button>
              </div>
              {beltChainStatus === "error" && (
                <div style={{ color: "var(--red)", fontSize: 11, marginTop: 4 }}>{beltChainError}</div>
              )}
              {beltChainStatus === "done" && beltChainResult && (
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
                  {beltChainResult.make || "?"} {beltChainResult.model || ""}, {beltChainResult.fuelType || "?"}, {beltChainResult.cc ? `${beltChainResult.cc}cc` : "cc unknown"}
                  {beltChainResult.matches.length === 0 && (
                    <div style={{ marginTop: 4 }}>No match in the belt/chain list for this engine — add it to the list in the API route if known.</div>
                  )}
                  {beltChainResult.matches.map((m, i) => (
                    <div key={i} style={{ marginTop: 4, padding: 8, border: "1px solid var(--line)", borderRadius: 6 }}>
                      <div style={{ fontWeight: 700, color: "var(--text)" }}>{m.name} — {m.type === "belt" ? "TIMING BELT" : "TIMING CHAIN"}</div>
                      <div>Part: {m.partNumber || "not recorded yet"}</div>
                      {m.notes && <div style={{ marginTop: 2 }}>{m.notes}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div><label className="wb-label">Business</label><select className="wb-select" value={business} onChange={(e) => setBusiness(e.target.value)}>{BUSINESSES.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
            <div>
              <label className="wb-label">Make</label>
              <select className="wb-select" value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)}>
                <option value="">Not set</option>
                {brands.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                <option value="Other">Other / not listed</option>
              </select>
              {vehicleMake === "Other" && (
                <input className="wb-input" style={{ marginTop: 6 }} placeholder="Make" value={vehicleMakeOther} onChange={(e) => setVehicleMakeOther(e.target.value)} />
              )}
            </div>
            <div>
              <label className="wb-label">Model</label>
              <input className="wb-input" list="vehicle-model-suggestions" placeholder="e.g. Discovery Sport" value={vehicleModelText} onChange={(e) => setVehicleModelText(e.target.value)} />
              <datalist id="vehicle-model-suggestions">
                {VEHICLE_MODELS.map((m) => <option key={m} value={m} />)}
              </datalist>
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>Range Rover Evoque/Velar, Discovery Sport/5, E-Pace/F-Pace/XE/XF auto-pick the right thermostat housing below.</div>
            </div>
          </div>
          <div><label className="wb-label">Symptoms / notes</label><textarea className="wb-textarea" rows={3} value={symptoms} onChange={(e) => setSymptoms(e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div><label className="wb-label">Job type</label><select className="wb-select" value={jobTypeId} onChange={(e) => { setJobTypeId(e.target.value); setExtraJobTypeIds((prev) => prev.filter((x) => x !== e.target.value)); }}>{jobTypes.map((jt) => <option key={jt.id} value={jt.id}>{jt.name}</option>)}</select></div>
            <div><label className="wb-label">Booking date</label><input type="date" className="wb-input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><label className="wb-label">Days in for</label><input type="number" min="1" className="wb-input" value={days} onChange={(e) => { setDaysTouched(true); setDays(Math.max(1, parseInt(e.target.value) || 1)); }} /></div>
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
            <label className="wb-label">Payment method (agreed with customer)</label>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {PAYMENT_METHODS.map((m) => (
                <label key={m} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={paymentMethod === m} onChange={() => setPaymentMethod(paymentMethod === m ? "" : m)} />
                  {m}
                </label>
              ))}
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
                  const partId = THERMOSTAT_MODEL_MAP[vehicleModelText.trim()];
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
            paymentMethod,
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

  // Cards with a "required by" date float to the top, soonest first, so the
  // workshop can see what needs picking up next rather than just whatever
  // was last touched — everything else keeps falling back to recency.
  const recentCards = useMemo(() => {
    const withDue = jobCards.filter((c) => c.requiredBy).sort((a, b) => (a.requiredBy < b.requiredBy ? -1 : a.requiredBy > b.requiredBy ? 1 : 0));
    const withoutDue = jobCards.filter((c) => !c.requiredBy);
    return [...withDue, ...withoutDue].slice(0, 6);
  }, [jobCards]);

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
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                    {c.locked && <span className="jc-chip locked"><Lock size={10} style={{ display: "inline", marginRight: 3 }} />signed</span>}
                    {c.requiredBy && (
                      <span
                        className="jc-chip"
                        style={c.requiredBy < todayISO() ? { background: "#241512", color: "var(--red)" } : c.requiredBy === todayISO() ? { background: "#241d10", color: "var(--amber2)" } : {}}
                      >
                        Due {fmtDate(c.requiredBy)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Job cards auto-save on every keystroke, with no debounce, straight to
// Supabase — fine for one field on one card, but with several technicians
// each on a different job card at once, a fast typist fires overlapping
// writes for the same field that can land out of order, and the table-wide
// realtime subscription (any job card's change refetches the whole table)
// can then pull back a stale value and visibly wipe out what was just typed.
// This buffers keystrokes locally and only pushes upstream (and to Supabase)
// once typing pauses, so there's one write per pause instead of one per
// character — and ignores incoming prop updates while a write is still
// pending, so a stale realtime refetch can't stomp on unsaved local edits.
function useDebouncedField(value, onChange, delay = 600) {
  const [local, setLocal] = useState(value || "");
  const timerRef = useRef(null);
  const pendingRef = useRef(false);
  useEffect(() => { if (!pendingRef.current) setLocal(value || ""); }, [value]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const setValue = (v) => {
    setLocal(v);
    pendingRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { pendingRef.current = false; onChange(v); }, delay);
  };
  return [local, setValue];
}

function Field({ label, value, onChange, disabled, placeholder }) {
  const [local, setLocal] = useDebouncedField(value, onChange);
  return <div><label className="jc-label">{label}</label><input className="jc-input" value={local} disabled={disabled} placeholder={placeholder} onChange={(e) => setLocal(e.target.value)} /></div>;
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
  const supported = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  // Continuous speech recognition fires onresult many times a second while
  // someone's actually speaking — without debouncing that's many Supabase
  // writes a second for one field, the exact overlapping-write problem this
  // hook exists to avoid, so dictation runs through it the same as typing.
  const [local, setLocal] = useDebouncedField(value, onChange);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState(null);

  const convertToEnglish = async () => {
    if (disabled || translating || !local?.trim()) return;
    setTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch("/api/office/translate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: local }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Translation failed");
      setLocal(data.translated);
    } catch (e) {
      setTranslateError(e.message || "Translation failed");
    } finally {
      setTranslating(false);
    }
  };

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
    // Captured once per session in this closure, not a shared ref — a
    // recognition session that delivers its final result slightly late
    // (e.g. mic auto-stopped on a pause, then dictation was restarted)
    // must keep prepending onto the base it actually started from, not
    // whatever base a newer session has since moved on to. A shared ref
    // here was re-appending already-saved text on every restart. Builds on
    // `local` (what's actually on screen right now), not the upstream
    // `value` prop, which may still be a debounce-cycle behind.
    const sessionBase = local ? local + " " : "";
    recog.onresult = (e) => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; setLocal(sessionBase + t); };
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
            <button className="jc-btn-sm" disabled={translating || !local?.trim()} onClick={convertToEnglish} type="button" style={translating ? { opacity: 0.6 } : {}}>
              <Languages size={14} /> {translating ? "Converting…" : "Convert to English"}
            </button>
          </div>
        )}
      </div>
      <textarea className="jc-textarea" rows={rows} value={local} disabled={disabled} onChange={(e) => setLocal(e.target.value)} placeholder="Tap here, then use your keyboard's dictation button to speak this in…" style={disabled ? { opacity: 0.6 } : {}} />
      {translateError && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 4 }}>{translateError}</div>}
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
  const [writeupGenerating, setWriteupGenerating] = useState(false);
  const [writeupError, setWriteupError] = useState(null);
  const writeupTimerRef = useRef(null);
  // Seeded with whatever's already in the two fields when the card is
  // opened, so reopening an unchanged card never re-triggers a generation
  // — only edits made from this point on will move the content away from
  // this snapshot and start the debounce.
  const writeupLastSentRef = useRef(`${card.technicianInterpretation || ""}|${card.diagnosisFindings || ""}`);

  // Auto-regenerates the technical write-up ~8s after the technician stops
  // editing either field — long enough to not fire mid-dictation (which
  // saves on every interim speech result) or between quick edits, short
  // enough that the write-up is ready well before anyone goes looking for it.
  useEffect(() => {
    const content = `${card.technicianInterpretation || ""}|${card.diagnosisFindings || ""}`;
    if (!card.technicianInterpretation?.trim() && !card.diagnosisFindings?.trim()) return;
    if (content === writeupLastSentRef.current) return;

    if (writeupTimerRef.current) clearTimeout(writeupTimerRef.current);
    writeupTimerRef.current = setTimeout(async () => {
      writeupLastSentRef.current = content;
      setWriteupGenerating(true);
      setWriteupError(null);
      try {
        const res = await fetch("/api/office/technical-writeup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobCardId: card.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to generate the write-up");
      } catch (e) {
        setWriteupError(e.message || "Failed to auto-generate the technical write-up");
      }
      setWriteupGenerating(false);
    }, 8000);

    return () => clearTimeout(writeupTimerRef.current);
  }, [card.id, card.technicianInterpretation, card.diagnosisFindings]);

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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label className="jc-label">Date in</label><input type="date" className="jc-input" value={card.dateIn} onChange={(e) => setField("dateIn", e.target.value)} /></div>
            <div><label className="jc-label">Date out</label><input type="date" className="jc-input" value={card.dateOut} onChange={(e) => setField("dateOut", e.target.value)} /></div>
            <div><label className="jc-label">Required by</label><input type="date" className="jc-input" value={card.requiredBy || ""} onChange={(e) => setField("requiredBy", e.target.value)} /></div>
            <Field label="Technician" value={card.technician} onChange={(v) => setField("technician", v)} />
          </div>
        </div>

        <div className="jc-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="jc-section-title" style={{ marginBottom: 0 }}><Car size={16} /> Vehicle details</div>
            {booking && (
              <button
                className="jc-btn-sm"
                onClick={() => {
                  const { make, model } = guessMakeModel(booking.vehicleModel);
                  onUpdate({ make, model, reg: booking.reg || card.reg });
                }}
              >
                Pull from booking
              </button>
            )}
          </div>
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

        <div className="jc-card">
          <div className="jc-section-title">Pre-diagnostic checks</div>
          <Toggle label="Pre scan completed & emailed" on={card.preDiagnostic.preScanCompleted} onClick={() => setNested("preDiagnostic", "preScanCompleted", !card.preDiagnostic.preScanCompleted)} />
        </div>

        <div className="jc-card"><div className="jc-section-title">Diagnosis & findings</div><DictateField value={card.diagnosisFindings} onChange={(v) => setField("diagnosisFindings", v)} rows={6} /></div>

        <div className="jc-card">
          <div className="jc-section-title">Technical write-up (warranty / legal)</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            AI-tightened version of the technician interpretation and diagnosis findings above — keeps the technical detail, doesn't simplify anything. Auto-generates as a PDF to the shared Drive folder shortly after you stop editing either field.
          </div>
          {writeupGenerating && <div style={{ fontSize: 12, color: "var(--amber2)" }}>Generating…</div>}
          {!writeupGenerating && card.technicalWriteupUrl && (
            <div style={{ fontSize: 13 }}>
              <a href={card.technicalWriteupUrl} target="_blank" rel="noreferrer" style={{ color: "var(--amber)" }}>Open the current PDF</a>
              {card.technicalWriteupUpdatedAt && <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 11 }}>Updated {new Date(card.technicalWriteupUpdatedAt).toLocaleString("en-GB")}</span>}
            </div>
          )}
          {!writeupGenerating && !card.technicalWriteupUrl && <div style={{ fontSize: 12, color: "var(--muted)" }}>Nothing generated yet — add some notes above.</div>}
          {writeupError && <div style={{ marginTop: 10, fontSize: 12, color: "var(--red)" }}>{writeupError}</div>}
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
