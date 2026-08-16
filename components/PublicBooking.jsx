"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Check, Wrench, AlertTriangle, HelpCircle, CalendarClock } from "lucide-react";
import { fetchJobTypes } from "@/lib/data";
import { BUSINESSES } from "@/lib/constants";

const DAILY_CAP = 3;
const MIN_NOTICE_DAYS = 7;
const CONTACT_PHONE = "07521543379";
const TERMS_URL = "https://www.warrington4x4.co.uk/terms-and-conditions";
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};

// All of the sub-components below live at module scope rather than nested
// inside PublicBooking() — a component defined inside another component's
// body gets a new function identity on every render of the parent, which
// makes React treat it as a completely different component and remount its
// DOM node from scratch. For a text input that means losing focus (and the
// cursor position) after every single keystroke, since the parent re-renders
// on every keystroke to update the controlled value.

const ContactEscapeHatch = () => (
  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
    <a href={`tel:${CONTACT_PHONE}`} className="pb-btn" style={{ width: "auto", padding: "10px 16px", fontSize: 13 }}>Need it sooner? Call us</a>
    <a href={`https://wa.me/44${CONTACT_PHONE.slice(1)}`} target="_blank" rel="noreferrer" className="pb-btn" style={{ width: "auto", padding: "10px 16px", fontSize: 13, background: "#25D366", color: "#0b1a10" }}>Message us on WhatsApp</a>
  </div>
);

const ContactFields = ({ form, setForm }) => (
  <>
    <div><label className="pb-label">Name</label><input className="pb-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
    <div>
      <label className="pb-label">Which business are you booking with?</label>
      <select className="pb-input" value={form.business} onChange={(e) => setForm((f) => ({ ...f, business: e.target.value }))}>
        {BUSINESSES.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
    </div>
    <div><label className="pb-label">Email address</label><input type="email" className="pb-input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
    <div><label className="pb-label">Address</label><input className="pb-input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></div>
    <div><label className="pb-label">Mobile number</label><input className="pb-input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
    <div><label className="pb-label">Vehicle registration</label><input className="pb-input" value={form.reg} onChange={(e) => setForm((f) => ({ ...f, reg: e.target.value.toUpperCase() }))} /></div>
    <div className={`pb-check ${form.isNonRunner ? "on" : ""}`} onClick={() => setForm((f) => ({ ...f, isNonRunner: !f.isNonRunner }))}>
      <div style={{ width: 18, height: 18, borderRadius: 4, border: "2px solid currentColor", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{form.isNonRunner && <Check size={12} />}</div>
      Is it a non-runner?
    </div>
    <div>
      <label className="pb-label">Symptoms / engine management lights</label>
      <textarea
        className="pb-textarea" rows={3} placeholder="e.g. rattling on cold start, engine management light on"
        value={form.symptoms} onChange={(e) => setForm((f) => ({ ...f, symptoms: e.target.value }))}
      />
    </div>
  </>
);

// Shown when the customer picks a date inside the notice window — they can
// still fill the form in and try (the server has the final say and offers
// the same call/WhatsApp escape hatch if it's genuinely too soon), but this
// steers them toward Emergency or a direct call up front instead of just
// silently blocking the day like before.
const EmergencyNudge = () => (
  <div className="pb-panel" style={{ borderColor: "var(--amber)", background: "#2a2210", display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "var(--amber2)" }}>
      <AlertTriangle size={16} /> That's a bit soon for a standard booking
    </div>
    <div style={{ fontSize: 13 }}>
      We do have emergency appointments — please fill in the booking below or call us on{" "}
      <a href={`tel:${CONTACT_PHONE}`} style={{ color: "var(--amber2)" }}>{CONTACT_PHONE}</a>.
    </div>
    <ContactEscapeHatch />
  </div>
);

// The checkbox stays disabled until the customer has actually clicked
// through to the terms — ticking it is meant to follow reading it, not
// substitute for reading it. termsViewed only ever goes true (there's no
// way to "unread" it once clicked), so re-opening the link a second time
// doesn't reset anything.
const TermsGate = ({ termsViewed, setTermsViewed, termsAccepted, setTermsAccepted }) => (
  <div>
    <a
      href={TERMS_URL} target="_blank" rel="noreferrer" onClick={() => setTermsViewed(true)}
      style={{ color: "var(--amber2)", fontSize: 13, display: "inline-block", marginBottom: 8 }}
    >
      Read our Terms & Conditions ↗
    </a>
    <div
      className={`pb-check ${termsAccepted ? "on" : ""}`}
      style={!termsViewed ? { opacity: 0.5, cursor: "not-allowed" } : {}}
      onClick={() => { if (termsViewed) setTermsAccepted((v) => !v); }}
    >
      <div style={{ width: 18, height: 18, borderRadius: 4, border: "2px solid currentColor", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{termsAccepted && <Check size={12} />}</div>
      I have read and accept the Terms &amp; Conditions
    </div>
    {!termsViewed && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Please open and read the Terms &amp; Conditions above first.</div>}
  </div>
);

const ResultAndSubmit = ({ result, canSubmit, submitting, submit, termsViewed, setTermsViewed, termsAccepted, setTermsAccepted }) => (
  <>
    <TermsGate termsViewed={termsViewed} setTermsViewed={setTermsViewed} termsAccepted={termsAccepted} setTermsAccepted={setTermsAccepted} />
    {result?.error && <div style={{ color: "var(--red)", fontSize: 13 }}>{result.error}</div>}
    {result?.error && result.offerContact && <ContactEscapeHatch />}
    {result?.ok && <div style={{ color: "var(--green)", fontSize: 14, fontWeight: 700 }}>Thanks — your booking request has been sent. We'll be in touch to confirm.</div>}
    <button className="pb-btn" disabled={!canSubmit || submitting} onClick={submit}>{submitting ? "Sending…" : "Request this booking"}</button>
  </>
);

const Calendar = ({ year, month, monthCursor, setMonthCursor, cells, availability, capFor, minBookableISO, selectedDay, openDay }) => (
  <div className="pb-panel">
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <button className="pb-btn" style={{ width: "auto", padding: "8px 12px" }} onClick={() => setMonthCursor(new Date(year, month - 1, 1))}><ChevronLeft size={16} /></button>
      <div style={{ fontWeight: 700 }}>{monthCursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
      <button className="pb-btn" style={{ width: "auto", padding: "8px 12px" }} onClick={() => setMonthCursor(new Date(year, month + 1, 1))}><ChevronRight size={16} /></button>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} style={{ fontSize: 10, color: "var(--muted)", textAlign: "center" }}>{d}</div>)}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
      {cells.map((d, i) => {
        if (!d) return <div key={i} style={{ visibility: "hidden" }} />;
        const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const count = availability[iso] || 0;
        const dayCap = capFor(iso);
        const isFull = count >= dayCap;
        const isPast = iso < todayISO();
        const isTooSoon = !isPast && iso < minBookableISO;
        const statusClass = isFull ? "full" : count > 0 ? "amber" : "green";
        const statusLabel = isPast ? "" : isTooSoon ? "Needs 7 days notice" : isFull ? "Full" : count > 0 ? "Some availability" : "Availability";
        return (
          <div key={i} className={`pb-day ${isFull ? "full" : ""} ${isPast ? "past" : ""} ${isTooSoon ? "soon" : ""} ${iso === selectedDay ? "selected" : ""}`} onClick={() => openDay(iso, count)}>
            <div className="pb-daynum">{d}</div>
            <div className={`pb-slots ${isPast ? "" : isTooSoon ? "soon" : statusClass}`}>{statusLabel}</div>
          </div>
        );
      })}
    </div>
  </div>
);

export default function PublicBooking() {
  // Three distinct intake paths rather than one combined form — a real job
  // type + single date, an emergency (two preferred dates, no notice/
  // capacity rules), or a free-text "something else" request. Kept separate
  // rather than combinable checkboxes since mixing e.g. a real job type with
  // Emergency doesn't mean anything coherent.
  const [path, setPath] = useState(null); // null | "standard" | "emergency" | "other"
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [availability, setAvailability] = useState({});
  const [dayCaps, setDayCaps] = useState({}); // per-date cap, shrunk when a technician's on holiday
  const [jobTypes, setJobTypes] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [form, setForm] = useState({ name: "", address: "", phone: "", email: "", reg: "", business: BUSINESSES[0], requirements: [], otherDetails: "", isNonRunner: false, symptoms: "" });
  const [emergencyDate1, setEmergencyDate1] = useState("");
  const [emergencyDate2, setEmergencyDate2] = useState("");
  const [termsViewed, setTermsViewed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { ok: true } | { error: string, offerContact?: bool }

  const year = monthCursor.getFullYear(), month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = []; for (let i = 0; i < startOffset; i++) cells.push(null); for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  useEffect(() => {
    // Only the job types office has marked as safe for customer self-service
    // show up here — everything else still needs a real conversation.
    fetchJobTypes().then((jts) => setJobTypes(jts.filter((jt) => jt.publicBookable))).catch(() => setJobTypes([]));
  }, []);

  useEffect(() => {
    if (path === "emergency") return; // no calendar in this path
    const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const end = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
    fetch(`/api/public/availability?start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((d) => { setAvailability(d.counts || {}); setDayCaps(d.caps || {}); })
      .catch(() => { setAvailability({}); setDayCaps({}); });
  }, [year, month, daysInMonth, path]);

  const capFor = (iso) => dayCaps[iso] ?? DAILY_CAP;

  const toggleRequirement = (name) => {
    setForm((f) => ({
      ...f,
      requirements: f.requirements.includes(name) ? f.requirements.filter((r) => r !== name) : [...f.requirements, name],
    }));
  };
  const minBookableISO = addDaysISO(todayISO(), MIN_NOTICE_DAYS);

  const openDay = (iso, count) => {
    // Days inside the notice window are still selectable (previously blocked
    // outright) — picking one just shows a nudge toward Emergency/calling
    // instead of silently refusing the click. Full/closed days stay blocked
    // since there's genuinely no room.
    if (count >= capFor(iso) || iso < todayISO()) return;
    setSelectedDay(iso);
    setResult(null);
  };

  const resetAll = () => {
    setPath(null);
    setResult(null);
    setSelectedDay(null);
    setForm({ name: "", address: "", phone: "", email: "", reg: "", business: BUSINESSES[0], requirements: [], otherDetails: "", isNonRunner: false, symptoms: "" });
    setEmergencyDate1(""); setEmergencyDate2("");
    setTermsViewed(false); setTermsAccepted(false);
  };

  const canSubmit = (() => {
    if (!form.name.trim() || !form.phone.trim() || !form.reg.trim() || !form.email.trim() || !form.symptoms.trim()) return false;
    if (!termsAccepted) return false;
    if (path === "emergency") return !!emergencyDate1 && !!emergencyDate2;
    if (path === "other") return !!selectedDay && form.otherDetails.trim().length > 0;
    if (path === "standard") return !!selectedDay && form.requirements.length > 0;
    return false;
  })();

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    const base = {
      name: form.name.trim(), address: form.address.trim(), phone: form.phone.trim(), email: form.email.trim(),
      reg: form.reg.trim().toUpperCase(), business: form.business, isNonRunner: form.isNonRunner, symptoms: form.symptoms.trim(),
      termsAccepted,
    };
    const payload =
      path === "emergency" ? { ...base, isEmergency: true, date: emergencyDate1, secondDate: emergencyDate2 } :
      path === "other" ? { ...base, date: selectedDay, requirements: ["Other"], otherDetails: form.otherDetails.trim() } :
      { ...base, date: selectedDay, requirements: form.requirements };
    try {
      const res = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ error: data.error || "Something went wrong.", offerContact: !!data.offerContact });
        if (selectedDay) setAvailability((a) => ({ ...a, [selectedDay]: capFor(selectedDay) })); // reflect it's now full
      } else {
        setResult({ ok: true });
        if (selectedDay) setAvailability((a) => ({ ...a, [selectedDay]: (a[selectedDay] || 0) + 1 }));
      }
    } catch {
      setResult({ error: "Network error — please try again." });
    }
    setSubmitting(false);
  };

  return (
    <div style={{ "--bg": "#16181a", "--panel": "#1e2124", "--panel2": "#25292c", "--line": "#33383c", "--text": "#e7e3da", "--muted": "#9aa0a6", "--amber": "#f5a623", "--amber2": "#ffcf6b", "--red": "#e2574c", "--green": "#5fb87a" }} className="pb-root">
      <style>{`
        .pb-root { background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, sans-serif; min-height: 100vh; }
        .pb-header { padding: 20px; border-bottom: 1px solid var(--line); font-weight: 800; font-size: 18px; display:flex; align-items:center; gap:8px; }
        .pb-body { padding: 20px; max-width: 640px; margin: 0 auto; display:flex; flex-direction:column; gap: 20px; }
        .pb-panel { background: var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; }
        .pb-day { min-height:56px; border:1px solid var(--line); border-radius:6px; padding:6px; cursor:pointer; display:flex; flex-direction:column; gap:4px; }
        .pb-day.full { opacity: 0.4; cursor: not-allowed; }
        .pb-day.past { opacity: 0.25; cursor: not-allowed; }
        .pb-day.soon { border-style: dashed; }
        .pb-day.selected { border-color: var(--amber); box-shadow: inset 0 0 0 1px var(--amber); }
        .pb-daynum { font-size:12px; font-weight:600; color: var(--muted); }
        .pb-slots { font-size:10px; }
        .pb-slots.green { color: var(--green); }
        .pb-slots.amber { color: var(--amber2); }
        .pb-slots.full { color: var(--red); }
        .pb-slots.soon { color: var(--muted); }
        .pb-input, .pb-textarea { width:100%; background: var(--panel2); border:1px solid var(--line); color:var(--text); border-radius:8px; padding:12px; font-size:16px; font-family:inherit; }
        .pb-label { font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:5px; display:block; font-weight:600; }
        .pb-check { display:flex; align-items:center; gap:10px; padding:12px 14px; border-radius:8px; border:1px solid var(--line); background: var(--panel2); cursor:pointer; font-size:14px; }
        .pb-check.on { background:#1c2f22; border-color: var(--green); color: var(--green); font-weight:700; }
        .pb-btn { background: var(--amber); color:#1a1508; font-weight:700; border:none; border-radius:8px; padding:14px 16px; font-size:15px; cursor:pointer; width:100%; }
        .pb-btn:disabled { opacity:0.5; cursor:not-allowed; }
        .pb-option { background: var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; cursor:pointer; display:flex; align-items:flex-start; gap:14px; text-align:left; width:100%; }
        .pb-option:hover { border-color: var(--amber); }
        .pb-back { background:none; border:none; color: var(--muted); cursor:pointer; font-size:13px; padding:0; display:flex; align-items:center; gap:4px; }
      `}</style>

      <div className="pb-header"><Wrench size={20} color="var(--amber)" /> Book your vehicle in</div>

      <div className="pb-body">
        {path === null && (
          <>
            <button className="pb-option" onClick={() => setPath("standard")}>
              <Check size={20} color="var(--green)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Choose from our common jobs</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Pick a job type and a date — the quickest way to book.</div>
              </div>
            </button>
            <button className="pb-option" onClick={() => setPath("emergency")}>
              <AlertTriangle size={20} color="var(--red)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Emergency appointment</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Give us two preferred dates and we'll call you back to confirm — no need to wait for a free slot.</div>
              </div>
            </button>
            <button className="pb-option" onClick={() => setPath("other")}>
              <HelpCircle size={20} color="var(--amber2)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Something else</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Not on our common jobs list? Tell us what you need and pick a date.</div>
              </div>
            </button>
          </>
        )}

        {path !== null && (
          <button className="pb-back" onClick={resetAll}><ChevronLeft size={14} /> Back to options</button>
        )}

        {path === "standard" && (
          <>
            <Calendar year={year} month={month} monthCursor={monthCursor} setMonthCursor={setMonthCursor} cells={cells}
              availability={availability} capFor={capFor} minBookableISO={minBookableISO} selectedDay={selectedDay} openDay={openDay} />
            {selectedDay && selectedDay < minBookableISO && <EmergencyNudge />}
            {selectedDay && (
              <div className="pb-panel">
                <div style={{ fontWeight: 700, marginBottom: 14 }}>Booking for {fmtDate(selectedDay)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <ContactFields form={form} setForm={setForm} />
                  <div>
                    <label className="pb-label">Requirement (select any that apply)</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {jobTypes.map((jt) => {
                        const on = form.requirements.includes(jt.name);
                        return (
                          <div key={jt.id} className={`pb-check ${on ? "on" : ""}`} onClick={() => toggleRequirement(jt.name)}>
                            <div style={{ width: 18, height: 18, borderRadius: 4, border: "2px solid currentColor", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{on && <Check size={12} />}</div>
                            {jt.name}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <ResultAndSubmit result={result} canSubmit={canSubmit} submitting={submitting} submit={submit} termsViewed={termsViewed} setTermsViewed={setTermsViewed} termsAccepted={termsAccepted} setTermsAccepted={setTermsAccepted} />
                </div>
              </div>
            )}
          </>
        )}

        {path === "other" && (
          <>
            <Calendar year={year} month={month} monthCursor={monthCursor} setMonthCursor={setMonthCursor} cells={cells}
              availability={availability} capFor={capFor} minBookableISO={minBookableISO} selectedDay={selectedDay} openDay={openDay} />
            {selectedDay && selectedDay < minBookableISO && <EmergencyNudge />}
            {selectedDay && (
              <div className="pb-panel">
                <div style={{ fontWeight: 700, marginBottom: 14 }}>Booking for {fmtDate(selectedDay)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <ContactFields form={form} setForm={setForm} />
                  <div>
                    <label className="pb-label">What do you need?</label>
                    <textarea
                      className="pb-textarea" rows={3} placeholder="e.g. a one-day appointment for a wet belt on a Ford EcoBoost"
                      value={form.otherDetails} onChange={(e) => setForm((f) => ({ ...f, otherDetails: e.target.value }))}
                    />
                  </div>
                  <ResultAndSubmit result={result} canSubmit={canSubmit} submitting={submitting} submit={submit} termsViewed={termsViewed} setTermsViewed={setTermsViewed} termsAccepted={termsAccepted} setTermsAccepted={setTermsAccepted} />
                </div>
              </div>
            )}
          </>
        )}

        {path === "emergency" && (
          <div className="pb-panel">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontWeight: 700 }}>
              <AlertTriangle size={16} color="var(--red)" /> Emergency appointment
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
              Give us two dates that would work — we'll call you back to confirm rather than an automatic slot.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <ContactFields form={form} setForm={setForm} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label className="pb-label"><CalendarClock size={11} style={{ display: "inline", marginRight: 3 }} />First choice</label>
                  <input type="date" className="pb-input" min={todayISO()} value={emergencyDate1} onChange={(e) => setEmergencyDate1(e.target.value)} />
                </div>
                <div>
                  <label className="pb-label"><CalendarClock size={11} style={{ display: "inline", marginRight: 3 }} />Second choice</label>
                  <input type="date" className="pb-input" min={todayISO()} value={emergencyDate2} onChange={(e) => setEmergencyDate2(e.target.value)} />
                </div>
              </div>
              <ResultAndSubmit result={result} canSubmit={canSubmit} submitting={submitting} submit={submit} termsViewed={termsViewed} setTermsViewed={setTermsViewed} termsAccepted={termsAccepted} setTermsAccepted={setTermsAccepted} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
