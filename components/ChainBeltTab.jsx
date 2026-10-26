"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Search, Wrench, ExternalLink, Plus, X, Copy, Check } from "lucide-react";

// Chain & Belt quote tab.
// Reg -> /api/office/belt-or-chain (DVSA MOT History API + curated engine list,
// same route the booking modal's "Belt/chain?" button uses) -> Autodata hours
// typed in -> quote at the fixed labour rate.
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

const PARTS_TEMPLATE = {
  chain: ["Timing chain kit (chain, guides, tensioner)", "Gaskets & seals", "Engine oil", "Oil filter", "Coolant"],
  wet: ["Wet belt kit (belt, tensioner, idler)", "Gaskets & seals", "Engine oil", "Oil filter"],
  dry: ["Timing belt kit", "Water pump", "Coolant"],
};

// Which of OUR hub job types (and so which fixed price) a DVSA-matched engine
// is. Explicit patterns for the engines on the list; any engine added later
// falls back to "every distinctive word of its name appears in the job name".
const HUB_JOB_PATTERNS = {
  "JLR Ingenium 2.0 diesel": /ingenium.*diesel/i,
  "JLR Ingenium 2.0 petrol": /ingenium.*petrol/i,
  "Nissan 1.2 DIG-T": /nissan.*dig-?t/i,
  "Ford 1.0 EcoBoost (wet belt": /ford 1\.0 ecoboost wet belt/i,
  "Ford 1.0 EcoBoost (timing chain": /ford 1\.0 ecoboost timing chain/i,
  "Ford EcoBlue 1.5": /ecoblue wet belt \((std|transit)\)/i,
  "Ford EcoBlue 2.0": /ecoblue wet belt \((ranger|transit|std)\)/i,
  "VAG 2.0 TSI": /vag 2\.0 tsi/i,
  "VAG 2.0 TDI": /vag 2\.0 tdi/i,
  "Renault 1.2 TCe": /renault 1\.2 tce/i,
  "Renault/Vauxhall/Nissan 2.3 dCi": /2\.3 d(ci|ti)/i,
  "Vauxhall 1.4 Ecotec": /vauxhall 1\.4 ecotec/i,
  "PSA/Stellantis 1.2 PureTech": /puretech/i,
  "Peugeot/Citroën 1.6 HDi": /1\.6 hdi/i,
};
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

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
};
const money = (n) => `£${(Math.round(n * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const titleCase = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Remembers parts prices per engine on this device, so the second Ingenium
// quote of the week is already filled in.
const savedParts = {
  get(name) {
    try { return JSON.parse(localStorage.getItem(`cbq-parts:${name}`) || "null"); } catch { return null; }
  },
  set(name, parts) {
    try { localStorage.setItem(`cbq-parts:${name}`, JSON.stringify(parts)); } catch {}
  },
};

export function ChainBeltTab({ jobTypes = [] }) {
  const [reg, setReg] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [engineIdx, setEngineIdx] = useState(0);
  const [autodataHrs, setAutodataHrs] = useState("");
  const [parts, setParts] = useState([]);
  const [copied, setCopied] = useState(false);

  const engine = result?.matches?.[engineIdx] || null;
  const kind = engine ? kindOf(engine) : null;
  const [useHubPrice, setUseHubPrice] = useState(true);
  // Our own job(s) on the hub for this engine, and the fixed price if there is one.
  const hubJobs = useMemo(() => (engine ? hubJobsFor(engine.name, jobTypes) : []), [engine, jobTypes]);
  const hubJob = hubJobs.find((j) => j.standardPrice > 0) || null;

  // Load the saved (or template) parts list whenever an engine is picked.
  const selectEngine = (matches, i) => {
    setEngineIdx(i);
    const m = matches?.[i];
    setParts(m ? savedParts.get(m.name) || PARTS_TEMPLATE[kindOf(m)].map((name) => ({ name, cost: "" })) : []);
  };

  useEffect(() => {
    if (engine && parts.length) savedParts.set(engine.name, parts);
  }, [parts]); // eslint-disable-line react-hooks/exhaustive-deps

  const lookup = async (e) => {
    e?.preventDefault();
    if (!reg.trim()) return;
    setStatus("loading");
    setError("");
    setResult(null);
    setEngineIdx(0);
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
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  };

  const q = useMemo(() => {
    const adHrs = num(autodataHrs);
    const chargedHrs = adHrs > 0 ? adHrs + HIDDEN_EXTRA_HOURS : 0;
    const labour = chargedHrs * LABOUR_RATE;
    const partsTotal = parts.reduce((s, p) => s + num(p.cost), 0);
    const net = labour + partsTotal;
    const vat = net * VAT_RATE;
    return { adHrs, labour, partsTotal, net, vat, total: net + vat };
  }, [autodataHrs, parts]);

  const vehicleName = result ? [result.make, result.model].filter(Boolean).map(titleCase).join(" ") : "";
  const hubMessage = engine && hubJob && useHubPrice
    ? [
        `Hi, here's your quote for ${result.reg}${vehicleName ? ` (${vehicleName})` : ""}:`,
        "",
        `${KIND_LABEL[kind]} replacement`,
        `Total: ${money(hubJob.standardPrice)} inc VAT`,
        "",
        "Let us know if you'd like to book in.",
      ].join("\n")
    : "";
  const autodataMessage = engine && q.adHrs > 0
    ? [
        `Hi, here's your quote for ${result.reg}${vehicleName ? ` (${vehicleName})` : ""}:`,
        "",
        `${KIND_LABEL[kind]} replacement`,
        `Labour: ${money(q.labour)}`,
        `Parts: ${money(q.partsTotal)}`,
        `VAT: ${money(q.vat)}`,
        `Total: ${money(q.total)} inc VAT`,
        "",
        "Let us know if you'd like to book in.",
      ].join("\n")
    : "";
  const message = hubMessage || autodataMessage;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const updatePart = (i, field, value) => setParts((prev) => prev.map((p, j) => (j === i ? { ...p, [field]: value } : p)));

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
              {/* Our job on the hub */}
              <div className="wb-panel" style={{ borderLeft: `6px solid ${hubJob ? "var(--green)" : "var(--amber)"}` }}>
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
                    {hubJob && (
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 8, cursor: "pointer" }}>
                        <input type="checkbox" checked={useHubPrice} onChange={(e) => setUseHubPrice(e.target.checked)} />
                        Quote our set price ({money(hubJob.standardPrice)}) in the WhatsApp message
                      </label>
                    )}
                    {hubJob && q.adHrs > 0 && (
                      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>
                        Autodata-based quote below is {money(q.total)} — {q.total > hubJob.standardPrice ? `${money(q.total - hubJob.standardPrice)} more than` : q.total < hubJob.standardPrice ? `${money(hubJob.standardPrice - q.total)} less than` : "the same as"} our set price.
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Autodata */}
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

              {/* Parts */}
              <div className="wb-panel">
                <label className="wb-label">Parts (selling price)</label>
                {parts.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <input className="wb-input" style={{ flex: 1 }} value={p.name} onChange={(e) => updatePart(i, "name", e.target.value)} />
                    <input className="wb-input" style={{ width: 100 }} inputMode="decimal" placeholder="£" value={p.cost} onChange={(e) => updatePart(i, "cost", e.target.value)} />
                    <button type="button" className="wb-btn-ghost" style={{ padding: "0 10px" }} aria-label="Remove part" onClick={() => setParts((prev) => prev.filter((_, j) => j !== i))}><X size={14} /></button>
                  </div>
                ))}
                <button type="button" className="wb-btn-ghost" onClick={() => setParts((prev) => [...prev, { name: "", cost: "" }])}><Plus size={14} /> Add part</button>
              </div>

              {/* Quote */}
              <div className="wb-panel">
                {[["Labour", q.labour], ["Parts", q.partsTotal], ["VAT 20%", q.vat]].map(([label, v]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}>
                    <span>{label}</span><span className="wh-mono">{money(v)}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, fontSize: 22, fontWeight: 800 }}>
                  <span>Total</span><span className="wh-mono">{money(q.total)}</span>
                </div>
                {message ? (
                  <>
                    <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginTop: 12 }}>{message}</pre>
                    <button type="button" className="wb-btn" style={{ marginTop: 8 }} onClick={copy}>
                      {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy for WhatsApp"}
                    </button>
                  </>
                ) : (
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>{hubJob ? "Tick \"Quote our set price\" above, or enter the Autodata time, to get a message to copy." : "Enter the Autodata time to finish the quote."}</div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
