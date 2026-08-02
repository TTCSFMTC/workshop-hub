"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Check, Wrench } from "lucide-react";
import { fetchJobTypes } from "@/lib/data";
import { BUSINESSES } from "@/lib/constants";

const DAILY_CAP = 3;
const MIN_NOTICE_DAYS = 7;
const CONTACT_PHONE = "07521543379";
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};

export default function PublicBooking() {
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [availability, setAvailability] = useState({});
  const [dayCaps, setDayCaps] = useState({}); // per-date cap, shrunk when a technician's on holiday
  const [jobTypes, setJobTypes] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [form, setForm] = useState({ name: "", address: "", phone: "", reg: "", business: BUSINESSES[0], requirements: [] });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { ok: true } | { error: string }

  const year = monthCursor.getFullYear(), month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = []; for (let i = 0; i < startOffset; i++) cells.push(null); for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  useEffect(() => {
    fetchJobTypes().then(setJobTypes).catch(() => setJobTypes([]));
  }, []);

  useEffect(() => {
    const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const end = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
    fetch(`/api/public/availability?start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((d) => { setAvailability(d.counts || {}); setDayCaps(d.caps || {}); })
      .catch(() => { setAvailability({}); setDayCaps({}); });
  }, [year, month, daysInMonth]);

  const capFor = (iso) => dayCaps[iso] ?? DAILY_CAP;

  const toggleRequirement = (name) => {
    setForm((f) => ({
      ...f,
      requirements: f.requirements.includes(name) ? f.requirements.filter((r) => r !== name) : [...f.requirements, name],
    }));
  };
  const allSelected = jobTypes.length > 0 && form.requirements.length === jobTypes.length;
  const toggleAll = () => {
    setForm((f) => ({ ...f, requirements: allSelected ? [] : jobTypes.map((jt) => jt.name) }));
  };

  const minBookableISO = addDaysISO(todayISO(), MIN_NOTICE_DAYS);

  const openDay = (iso, count) => {
    if (count >= capFor(iso) || iso < minBookableISO) return;
    setSelectedDay(iso);
    setResult(null);
  };

  const canSubmit = form.name.trim() && form.phone.trim() && form.reg.trim() && form.requirements.length > 0 && selectedDay;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, date: selectedDay }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ error: data.error || "Something went wrong.", offerContact: !!data.offerContact });
        setAvailability((a) => ({ ...a, [selectedDay]: capFor(selectedDay) })); // reflect it's now full
      } else {
        setResult({ ok: true });
        setForm({ name: "", address: "", phone: "", reg: "", business: BUSINESSES[0], requirements: [] });
        setAvailability((a) => ({ ...a, [selectedDay]: (a[selectedDay] || 0) + 1 }));
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
        .pb-day.selected { border-color: var(--amber); box-shadow: inset 0 0 0 1px var(--amber); }
        .pb-daynum { font-size:12px; font-weight:600; color: var(--muted); }
        .pb-slots { font-size:10px; color: var(--green); }
        .pb-slots.full { color: var(--red); }
        .pb-input, .pb-textarea { width:100%; background: var(--panel2); border:1px solid var(--line); color:var(--text); border-radius:8px; padding:12px; font-size:16px; font-family:inherit; }
        .pb-label { font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:5px; display:block; font-weight:600; }
        .pb-check { display:flex; align-items:center; gap:10px; padding:12px 14px; border-radius:8px; border:1px solid var(--line); background: var(--panel2); cursor:pointer; font-size:14px; }
        .pb-check.on { background:#1c2f22; border-color: var(--green); color: var(--green); font-weight:700; }
        .pb-btn { background: var(--amber); color:#1a1508; font-weight:700; border:none; border-radius:8px; padding:14px 16px; font-size:15px; cursor:pointer; width:100%; }
        .pb-btn:disabled { opacity:0.5; cursor:not-allowed; }
      `}</style>

      <div className="pb-header"><Wrench size={20} color="var(--amber)" /> Book your vehicle in</div>

      <div className="pb-body">
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
              return (
                <div key={i} className={`pb-day ${isFull ? "full" : ""} ${isPast || isTooSoon ? "past" : ""} ${iso === selectedDay ? "selected" : ""}`} onClick={() => openDay(iso, count)}>
                  <div className="pb-daynum">{d}</div>
                  <div className={`pb-slots ${isFull ? "full" : ""}`}>{isPast ? "" : isTooSoon ? "Needs 7 days notice" : isFull ? "Full" : `${count}/${dayCap} booked`}</div>
                </div>
              );
            })}
          </div>
        </div>

        {selectedDay && (
          <div className="pb-panel">
            <div style={{ fontWeight: 700, marginBottom: 14 }}>Booking for {fmtDate(selectedDay)}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><label className="pb-label">Name</label><input className="pb-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
              <div>
                <label className="pb-label">Which business are you booking with?</label>
                <select className="pb-input" value={form.business} onChange={(e) => setForm((f) => ({ ...f, business: e.target.value }))}>
                  {BUSINESSES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div><label className="pb-label">Address</label><input className="pb-input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></div>
              <div><label className="pb-label">Mobile number</label><input className="pb-input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
              <div><label className="pb-label">Vehicle registration</label><input className="pb-input" value={form.reg} onChange={(e) => setForm((f) => ({ ...f, reg: e.target.value.toUpperCase() }))} /></div>
              <div>
                <label className="pb-label">Requirement (select any that apply)</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className={`pb-check ${allSelected ? "on" : ""}`} onClick={toggleAll}>
                    <div style={{ width: 18, height: 18, borderRadius: 4, border: "2px solid currentColor", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{allSelected && <Check size={12} />}</div>
                    All of the below
                  </div>
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
              {result?.error && <div style={{ color: "var(--red)", fontSize: 13 }}>{result.error}</div>}
              {result?.error && result.offerContact && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <a href={`tel:${CONTACT_PHONE}`} className="pb-btn" style={{ width: "auto", padding: "10px 16px", fontSize: 13 }}>Need it sooner? Call us</a>
                  <a href={`https://wa.me/44${CONTACT_PHONE.slice(1)}`} target="_blank" rel="noreferrer" className="pb-btn" style={{ width: "auto", padding: "10px 16px", fontSize: 13, background: "#25D366", color: "#0b1a10" }}>Message us on WhatsApp</a>
                </div>
              )}
              {result?.ok && <div style={{ color: "var(--green)", fontSize: 14, fontWeight: 700 }}>Thanks — your booking request has been sent. We'll be in touch to confirm.</div>}
              <button className="pb-btn" disabled={!canSubmit || submitting} onClick={submit}>{submitting ? "Sending…" : "Request this booking"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
