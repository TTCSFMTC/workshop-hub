"use client";

import React, { useEffect, useMemo, useState } from "react";
import { fetchChainBeltChecks, insertChainBeltCheck, updateChainBeltCheck, subscribeTable } from "@/lib/data";
import { Search, ExternalLink, Copy, Check } from "lucide-react";

// Chain & Belt quote tab.
// Reg -> /api/office/belt-or-chain (DVSA MOT History API + curated engine list,
// same route the booking modal's "Belt/chain?" button uses) -> matched to our
// own job on the hub (fixed price, parts included) -> the price and the
// copy-ready message come up straight away. No hours or parts to enter for a
// job we have on the hub; Autodata hours are only asked for when there isn't
// one (that quote is labour only).
//
// Pricing rules (Chris, Oct 2026):
//   - Labour £75/hr + VAT, whatever the job.
//   - A hidden 1.5 hrs is added on top of the Autodata time. It is never shown
//     to the customer or in the copied message — only folded into the labour £.
const LABOUR_RATE = 75;
const HIDDEN_EXTRA_HOURS = 1.5;
const VAT_RATE = 0.2;
const AUTODATA_URL = "https://workshop.autodata-group.com/";

const KIND_LABEL = { chain: "Timing chain", wet: "Wet belt", dry: "Timing belt" };
const KIND_COLOR = { chain: "var(--blue)", wet: "var(--red)", dry: "var(--green)" };
const kindOf = (m) => (m.type === "chain" ? "chain" : /wet belt/i.test(m.name) ? "wet" : "dry");

// Which of OUR hub job types (and so which fixed price) a DVSA-matched engine
// is. Explicit patterns for the engines on the list; any engine added later
// falls back to "every distinctive word of its name appears in the job name".
const HUB_JOB_PATTERNS = {
  "JLR Ingenium 2.0 diesel": /ingenium.*diesel/i,
  "JLR Ingenium 2.0 petrol": /ingenium.*petrol/i,
  "Nissan 1.2 DIG-T": /nissan.*dig-?t/i,
  "Ford 1.0 EcoBoost (wet belt": /ford 1\.0 ecoboost wet belt/i,
  "Ford 1.0 EcoBoost (timing chain": /ford 1\.0 ecoboost timing chain/i,
  "Ford EcoBlue 1.5": /ecoblue wet belt \(transit/i,
  "Ford EcoBlue 2.0": /ecoblue wet belt \(transit/i,
  "VAG 2.0 TSI": /vag 2\.0 tsi/i,
  "VAG 2.0 TDI": /vag 2\.0 tdi/i,
  "Renault 1.2 TCe": /renault 1\.2 tce/i,
  "Renault/Vauxhall/Nissan 2.3 dCi": /2\.3 d(ci|ti)/i,
  "Vauxhall 1.4 Ecotec": /vauxhall 1\.4 ecotec/i,
  "PSA/Stellantis 1.2 PureTech": /puretech/i,
  "Peugeot/Citroën 1.6 HDi": /1\.6 hdi/i,
};
// Engines where the price depends on a question put to the customer. The
// question is asked BEFORE any price is shown; "yes" picks the hub job whose
// name matches yesPattern, "no" picks the standard one (everything else).
const ENGINE_QUESTIONS = {
  "Ford 1.0 EcoBoost (wet belt": { question: "Is the oil warning light showing on the dash?", yesPattern: /oil light/i },
};
const questionFor = (engineName) => ENGINE_QUESTIONS[Object.keys(ENGINE_QUESTIONS).find((k) => engineName.startsWith(k))] || null;

// Extra on the set price for engines that cost us more to do — added to the
// quote and explained to the customer in the message.
const ENGINE_SURCHARGE = {
  "Ford 1.0 EcoBoost": 50,
  "PSA/Stellantis 1.2 PureTech": 50,
};
const surchargeFor = (engineName) => ENGINE_SURCHARGE[Object.keys(ENGINE_SURCHARGE).find((k) => engineName.startsWith(k))] || 0;

const FALLBACK_STOPWORDS = new Set(["timing", "chain", "belt", "wet", "dry", "later", "earlier", "replacement", "kit", "and"]);
function hubJobsFor(engineName, jobTypes) {
  const key = Object.keys(HUB_JOB_PATTERNS).find((k) => engineName.startsWith(k));
  const matches = (jobTypes || []).filter((j) => {
    if (key) return HUB_JOB_PATTERNS[key].test(j.name);
    const words = engineName.toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z0-9.]+/).filter((w) => w && !FALLBACK_STOPWORDS.has(w));
    return words.length > 0 && words.every((w) => j.name.toLowerCase().includes(w));
  });
  // Public (advertised) jobs with a price first.
  return matches.sort((a, b) => (b.publicBookable ? 1 : 0) - (a.publicBookable ? 1 : 0) || (b.standardPrice ? 1 : 0) - (a.standardPrice ? 1 : 0));
}

// How long the job takes, as the website advertises it (JLR Ingenium 3-4 days,
// EcoBlue Transit / Ranger 3, everything else 2-3 working days — never quote
// less than that).
function turnaroundFor(text) {
  if (/ingenium|jlr|land rover|jaguar/i.test(text)) return "3–4 working days";
  if (/ecoblue/i.test(text) && /transit|ranger/i.test(text)) return "3 working days";
  return "2–3 working days";
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
};
const money = (n) => `£${(Math.round(n * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const titleCase = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function ChainBeltTab({ jobTypes = [] }) {
  const [reg, setReg] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [engineIdx, setEngineIdx] = useState(0);
  const [autodataHrs, setAutodataHrs] = useState("");
  const [copied, setCopied] = useState(false);

  const engine = result?.matches?.[engineIdx] || null;
  const kind = engine ? kindOf(engine) : null;
  // Our own job(s) on the hub for this engine, and the fixed price if there is one.
  const [answer, setAnswer] = useState(null); // null (not asked yet) | "yes" | "no"
  // History: one row per reg checked, kept in Supabase so it's the same on every device.
  const [history, setHistory] = useState([]);
  const [historyOk, setHistoryOk] = useState(true);
  const [checkId, setCheckId] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => fetchChainBeltChecks().then((rows) => { if (live) { setHistory(rows); setHistoryOk(true); } }).catch(() => { if (live) setHistoryOk(false); });
    load();
    const unsub = subscribeTable("chain_belt_checks", load);
    return () => { live = false; unsub(); };
  }, []);
  const question = engine ? questionFor(engine.name) : null;
  const awaitingAnswer = !!question && answer === null;
  const hubJobs = useMemo(() => {
    if (!engine) return [];
    const all = hubJobsFor(engine.name, jobTypes);
    if (!question) return all;
    if (answer === null) return [];
    return all.filter((j) => question.yesPattern.test(j.name) === (answer === "yes"));
  }, [engine, jobTypes, question, answer]);
  const hubJob = hubJobs.find((j) => j.standardPrice > 0) || null;

  const selectEngine = (matches, i) => { setEngineIdx(i); setAnswer(null); };

  const lookup = async (e) => {
    e?.preventDefault();
    if (!reg.trim()) return;
    setStatus("loading");
    setError("");
    setResult(null);
    setCheckId(null);
    setEngineIdx(0);
    setAnswer(null);
    setAutodataHrs("");
    try {
      const res = await fetch("/api/office/belt-or-chain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      setResult(data);
      selectEngine(data.matches, 0);
      setStatus("done");
      // Log the check straight away (price and WhatsApp status fill in later).
      const id = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const vehicle = [data.make, data.model].filter(Boolean).map(titleCase).join(" ");
      const row = { id, reg: data.reg || reg, vehicle, job: data.matches?.[0]?.name || "", price: null, whatsappSent: false };
      setCheckId(id);
      setHistory((prev) => [{ ...row, createdAt: new Date().toISOString() }, ...prev]);
      insertChainBeltCheck(row).catch(() => setHistoryOk(false));
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  };

  const q = useMemo(() => {
    const adHrs = num(autodataHrs);
    const chargedHrs = adHrs > 0 ? adHrs + HIDDEN_EXTRA_HOURS : 0;
    const labour = chargedHrs * LABOUR_RATE;
    const vat = labour * VAT_RATE;
    return { adHrs, labour, vat, total: labour + vat };
  }, [autodataHrs]);

  const vehicleName = result ? [result.make, result.model].filter(Boolean).map(titleCase).join(" ") : "";
  const turnaround = engine ? turnaroundFor(`${engine.name} ${hubJob?.name || ""}`) : "";
  const intro = result ? `Hi, thank you for your enquiry about ${result.reg}${vehicleName ? ` (${vehicleName})` : ""}. Here's your quote:` : "";
  const outro = "Thanks again for getting in touch — let us know if you'd like to book in.";
  const surcharge = engine && hubJob ? surchargeFor(engine.name) : 0;
  const hubPrice = hubJob ? hubJob.standardPrice + surcharge : null;
  const hubMessage = engine && hubJob
    ? [
        intro,
        "",
        `${KIND_LABEL[kind]} replacement`,
        `Price: ${money(hubPrice)} inc VAT (fixed price, parts and labour included)`,
        ...(surcharge > 0 ? ["Please note, due to the engine model there is a slight lift in price."] : []),
        `Turnaround: ${turnaround}`,
        "",
        outro,
      ].join("\n")
    : "";
  const autodataMessage = engine && !hubJob && q.adHrs > 0
    ? [
        intro,
        "",
        `${KIND_LABEL[kind]} replacement`,
        `Labour: ${money(q.labour)}`,
        `VAT: ${money(q.vat)}`,
        `Total: ${money(q.total)} inc VAT (labour only — parts quoted separately)`,
        `Turnaround: ${turnaround}`,
        "",
        outro,
      ].join("\n")
    : "";
  const message = hubMessage || autodataMessage;

  // The price quoted (inc VAT) goes onto this check's history line once it's showing.
  const quotedPrice = engine ? (hubJob ? hubPrice : q.adHrs > 0 ? q.total : null) : null;
  const quotedJob = hubJob?.name || engine?.name || "";
  useEffect(() => {
    if (!checkId || quotedPrice === null) return;
    setHistory((prev) => prev.map((h) => (h.id === checkId ? { ...h, price: quotedPrice, job: quotedJob } : h)));
    updateChainBeltCheck(checkId, { price: quotedPrice, job: quotedJob }).catch(() => setHistoryOk(false));
  }, [checkId, quotedPrice, quotedJob]);

  const setSent = (id, sent) => {
    setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, whatsappSent: sent } : h)));
    updateChainBeltCheck(id, { whatsappSent: sent }).catch(() => setHistoryOk(false));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      if (checkId) setSent(checkId, true); // copied to send = WhatsApp sent
    } catch {}
  };

  return (
    <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Reg */}
      <form onSubmit={lookup} className="wb-panel" style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <div style={{ flex: 1, display: "flex", background: "#f7c600", border: "2px solid #111", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ background: "#1f4aa8", color: "#fff", fontWeight: 700, fontSize: 11, width: 30, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 6 }}>UK</div>
          <input
            aria-label="Registration"
            value={reg}
            onChange={(e) => setReg(e.target.value.toUpperCase())}
            placeholder="AB12 CDE"
            maxLength={10}
            style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", color: "#111", fontWeight: 800, fontSize: 28, letterSpacing: "0.06em", textAlign: "center", outline: "none", padding: "8px 6px" }}
          />
        </div>
        <button className="wb-btn" type="submit" disabled={!reg.trim() || status === "loading"}>
          <Search size={15} /> {status === "loading" ? "Checking…" : "Look up"}
        </button>
      </form>
      {status === "error" && <div style={{ color: "var(--red)", fontSize: 13 }}>{error}</div>}

      {status === "done" && result && (
        <>
          {/* Vehicle + verdict */}
          <div className="wb-panel">
            <div style={{ fontWeight: 700 }}>{result.reg} · {vehicleName || "Unknown vehicle"}</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {result.fuelType || "?"}, {result.cc ? `${result.cc}cc` : "cc unknown"}, {result.year || "year unknown"}
            </div>
            {result.matches.length === 0 && (
              <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>
                This engine isn&apos;t on the chain &amp; belt list yet. Check it in Autodata, then add it to ENGINES in app/api/office/belt-or-chain/route.js.
              </div>
            )}
            {result.matches.map((m, i) => {
              const k = kindOf(m);
              const selected = i === engineIdx;
              return (
                <div
                  key={m.name}
                  onClick={() => selectEngine(result.matches, i)}
                  style={{
                    marginTop: 10, padding: 12, borderRadius: 8, cursor: result.matches.length > 1 ? "pointer" : "default",
                    border: `1px solid ${selected && result.matches.length > 1 ? "var(--amber)" : "var(--line)"}`, borderLeft: `6px solid ${KIND_COLOR[k]}`,
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{KIND_LABEL[k]}</div>
                  <div style={{ fontWeight: 600 }}>{m.name}</div>
                  {m.notes && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{m.notes}</div>}
                </div>
              );
            })}
            {result.matches.length > 1 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>More than one engine fits — tap the right one.</div>}
          </div>

          {engine && (
            <>
              {/* Question first, for engines whose price depends on the answer */}
              {awaitingAnswer && (
                <div className="wb-panel" style={{ borderLeft: "6px solid var(--amber)" }}>
                  <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 10 }}>{question.question}</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button type="button" className="wb-btn" style={{ flex: 1, fontSize: 16, padding: "12px 0" }} onClick={() => setAnswer("yes")}>Yes</button>
                    <button type="button" className="wb-btn-ghost" style={{ flex: 1, fontSize: 16, padding: "12px 0" }} onClick={() => setAnswer("no")}>No</button>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>The price depends on the answer, so ask the customer before quoting.</div>
                </div>
              )}

              {/* Our job on the hub */}
              {!awaitingAnswer && (
              <div className="wb-panel" style={{ borderLeft: `6px solid ${hubJob ? "var(--green)" : "var(--amber)"}` }}>
                {question && (
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
                    {question.question} <strong>{answer === "yes" ? "Yes" : "No"}</strong> · <a href="#" onClick={(e) => { e.preventDefault(); setAnswer(null); }}>change</a>
                  </div>
                )}
                {hubJobs.length === 0 ? (
                  <div style={{ fontSize: 13 }}>
                    <strong>Not a job on the hub yet.</strong>
                    <span style={{ color: "var(--muted)" }}> There&apos;s no job type for {engine.name} — quote it from Autodata below, and add a job type if you want it priced and bookable.</span>
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{hubJobs.length > 1 ? "Our jobs on the hub for this engine" : "Our job on the hub"}</div>
                    {hubJobs.map((j) => (
                      <div key={j.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14, padding: "4px 0" }}>
                        <span>{j.name}{j.publicBookable ? <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "var(--green)" }}>ON WEBSITE</span> : null}</span>
                        <span className="wh-mono" style={{ fontWeight: 700 }}>{j.standardPrice > 0 ? `${money(j.standardPrice)} inc VAT` : "no price set"}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
              )}

              {!awaitingAnswer && (
              <>
              {/* Autodata hours — only when we have no set price for this engine */}
              {!hubJob && (
              <div className="wb-panel">
                <label className="wb-label">Autodata time (hrs)</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="wb-input" style={{ flex: 1 }} inputMode="decimal" placeholder="e.g. 9.4" value={autodataHrs} onChange={(e) => setAutodataHrs(e.target.value)} />
                  <a className="wb-btn-ghost" href={AUTODATA_URL} target="_blank" rel="noreferrer" style={{ whiteSpace: "nowrap" }}>
                    <ExternalLink size={14} /> Autodata
                  </a>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                  Search {result.reg} in Autodata, Repair times, {KIND_LABEL[kind].toLowerCase()} replacement.
                </div>
              </div>
              )}


              {/* Quote */}
              <div className="wb-panel">
                {hubJob ? (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 22, fontWeight: 800 }}>
                      <span>Price <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>— {hubJob.name}</span></span><span className="wh-mono">{money(hubPrice)}</span>
                    </div>
                    {surcharge > 0 && (
                      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
                        Includes {money(surcharge)} on our {money(hubJob.standardPrice)} set price for this engine; the message tells the customer there's a slight lift in price.
                      </div>
                    )}
                  </>
                ) : q.adHrs > 0 ? (
                  <>
                    {[["Labour", q.labour], ["VAT 20%", q.vat]].map(([label, v]) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}>
                        <span>{label}</span><span className="wh-mono">{money(v)}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, fontSize: 22, fontWeight: 800 }}>
                      <span>Total (labour only)</span><span className="wh-mono">{money(q.total)}</span>
                    </div>
                  </>
                ) : null}
                {message ? (
                  <>
                    <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginTop: 12 }}>{message}</pre>
                    <button type="button" className="wb-btn" style={{ marginTop: 8 }} onClick={copy}>
                      {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy for WhatsApp"}
                    </button>
                  </>
                ) : (
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>{hubJob ? "" : "Enter the Autodata time and the price comes up."}</div>
                )}
              </div>
              </>
              )}
            </>
          )}
        </>
      )}

      {/* History: one line per check */}
      <div className="wb-panel">
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Checks so far</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          One line per registration checked. WhatsApp turns to Y when you copy the message — untick it if you didn&apos;t actually send it.
        </div>
        {!historyOk && (
          <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 8 }}>History isn&apos;t saving — has migration 063 been run in Supabase?</div>
        )}
        {history.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>No checks yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="wb-table">
              <thead><tr><th>Date</th><th>Reg</th><th>Make / model</th><th>Price</th><th>WhatsApp sent</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="wh-mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{new Date(h.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="wh-mono" style={{ fontWeight: 700 }}>{h.reg}</td>
                    <td style={{ fontSize: 13 }}>{h.vehicle || "—"}</td>
                    <td className="wh-mono">{h.price !== null ? money(h.price) : "—"}</td>
                    <td>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 700, color: h.whatsappSent ? "var(--green)" : "var(--muted)" }}>
                        <input type="checkbox" checked={h.whatsappSent} onChange={(e) => setSent(h.id, e.target.checked)} /> {h.whatsappSent ? "Y" : "N"}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
