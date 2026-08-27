"use client";

import React, { useRef, useState } from "react";
import { ClipboardPaste, Send, Trash2, X, Plus, FileText, Upload } from "lucide-react";
import { BUSINESSES } from "@/lib/constants";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

const STATUS_LABEL = {
  needs_review: { label: "Needs review", color: "var(--amber2)" },
  confirmed: { label: "Confirmed", color: "#5aa7e0" },
  posted: { label: "Posted to Zoho", color: "var(--green)" },
};

function money(n) {
  return n == null ? "—" : `£${Number(n).toFixed(2)}`;
}

function recompute(lineItems, vatRate) {
  const subtotal = lineItems.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const roundedSubtotal = Math.round(subtotal * 100) / 100;
  const vat = Math.round(roundedSubtotal * (Number(vatRate) / 100) * 100) / 100;
  return { subtotal: roundedSubtotal, vat, total: Math.round((roundedSubtotal + vat) * 100) / 100 };
}

function QuoteCard({ quote, updateQuoteField, removeQuote }) {
  const [expanded, setExpanded] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [lineItems, setLineItems] = useState(quote.lineItems);
  const [vatRate, setVatRate] = useState(quote.vatRate);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  // Buffered locally so typing isn't fighting the live-sync round-trip —
  // updateQuoteField writes to Supabase and the realtime subscription can
  // echo a fresh `quote` prop back mid-keystroke, which would otherwise
  // stomp on whatever's still being typed. Only committed on blur.
  const [customerName, setCustomerName] = useState(quote.customerName);
  const [vehicleDescription, setVehicleDescription] = useState(quote.vehicleDescription);
  const [customerEmail, setCustomerEmail] = useState(quote.customerEmail);
  const [notes, setNotes] = useState(quote.notes);

  const posted = quote.status === "posted";
  const status = STATUS_LABEL[quote.status] || STATUS_LABEL.needs_review;

  const updateLine = (idx, field, value) => setLineItems((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const removeLine = (idx) => setLineItems((prev) => prev.filter((_, i) => i !== idx));
  const addLine = (type) => setLineItems((prev) => [...prev, { type, description: "", quantity: 1, unit_price: 0 }]);

  const totals = recompute(lineItems, vatRate);

  const saveLineItems = () => {
    const cleaned = lineItems.map((l) => ({
      type: l.type === "labour" ? "labour" : "part",
      description: l.description || "",
      quantity: Number(l.quantity) || 0,
      unit_price: Number(l.unit_price) || 0,
      amount: Math.round((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * 100) / 100,
    }));
    const { subtotal, vat, total } = recompute(cleaned, vatRate);
    updateQuoteField(quote.id, { lineItems: cleaned, vatRate: Number(vatRate), subtotal, vat, total });
  };

  const postToZoho = async () => {
    setPosting(true);
    setError("");
    try {
      const res = await fetch(`/api/office/quotes/${quote.id}/post-to-zoho`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Post failed"); return; }
    } catch {
      setError("Something went wrong.");
    } finally {
      setPosting(false);
    }
  };

  const canPost = (quote.customerName || "").trim().length > 0 && Number(quote.total) > 0;

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 12, background: "var(--panel2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <div>
            <label className="wb-label">Customer</label>
            <input
              className="wb-input" style={{ width: 150 }} value={customerName} disabled={posted}
              onChange={(e) => setCustomerName(e.target.value)}
              onBlur={() => updateQuoteField(quote.id, { customerName })}
              placeholder="Customer name"
            />
          </div>
          <div>
            <label className="wb-label">Vehicle</label>
            <input
              className="wb-input" style={{ width: 130 }} value={vehicleDescription} disabled={posted}
              onChange={(e) => setVehicleDescription(e.target.value)}
              onBlur={() => updateQuoteField(quote.id, { vehicleDescription })}
              placeholder="Reg / make / model"
            />
          </div>
          <div>
            <label className="wb-label">Email</label>
            <input
              className="wb-input" style={{ width: 170 }} value={customerEmail} disabled={posted}
              onChange={(e) => setCustomerEmail(e.target.value)}
              onBlur={() => updateQuoteField(quote.id, { customerEmail })}
              placeholder="Email"
            />
          </div>
          <div>
            <label className="wb-label">Business</label>
            <select
              className="wb-input" style={{ width: 170 }} value={quote.business} disabled={posted}
              onChange={(e) => updateQuoteField(quote.id, { business: e.target.value })}
            >
              {BUSINESSES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{money(quote.total)}</div>
          <div style={{ fontSize: 11, color: status.color, fontWeight: 700 }}>{status.label}</div>
          {quote.zohoEstimateNumber && (
            quote.zohoEstimateUrl
              ? <a href={quote.zohoEstimateUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--amber2)" }}>{quote.zohoEstimateNumber}</a>
              : <div style={{ fontSize: 11, color: "var(--muted)" }}>{quote.zohoEstimateNumber}</div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="wb-btn-ghost" style={{ minHeight: 32, padding: "6px 10px" }} onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Hide details" : "Details"}
        </button>
        {!posted && (
          <button
            className="wb-btn" style={{ width: "auto", minHeight: 32, padding: "6px 12px" }}
            disabled={posting || !canPost} title={!canPost ? "Needs a customer name and a total before it can post" : ""}
            onClick={postToZoho}
          >
            <Send size={13} /> {posting ? "Posting…" : "Post to Zoho"}
          </button>
        )}
        {!posted && (
          <button
            style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
            onClick={() => { if (confirm("Delete this quote?")) removeQuote(quote.id); }}
          >
            <Trash2 size={13} /> Delete
          </button>
        )}
        {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="wb-table">
              <thead>
                <tr>
                  <th>Type</th><th>Description</th><th>Qty / hrs</th><th>Unit price (ex VAT)</th><th>Amount</th>{!posted && <th></th>}
                </tr>
              </thead>
              <tbody>
                {lineItems.map((l, idx) => (
                  <tr key={idx}>
                    <td>
                      <select className="wb-input" style={{ width: 90 }} value={l.type} disabled={posted} onChange={(e) => updateLine(idx, "type", e.target.value)}>
                        <option value="part">Part</option>
                        <option value="labour">Labour</option>
                      </select>
                    </td>
                    <td>
                      <input className="wb-input" style={{ width: 220 }} value={l.description} disabled={posted} onChange={(e) => updateLine(idx, "description", e.target.value)} />
                    </td>
                    <td>
                      <input type="number" step="0.01" className="wb-input" style={{ width: 65 }} value={l.quantity} disabled={posted} onChange={(e) => updateLine(idx, "quantity", e.target.value)} />
                    </td>
                    <td>
                      <input type="number" step="0.01" className="wb-input" style={{ width: 85 }} value={l.unit_price} disabled={posted} onChange={(e) => updateLine(idx, "unit_price", e.target.value)} />
                    </td>
                    <td>{money((Number(l.quantity) || 0) * (Number(l.unit_price) || 0))}</td>
                    {!posted && (
                      <td><button onClick={() => removeLine(idx)} style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer" }}><X size={13} /></button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!posted && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="wb-btn-ghost" style={{ minHeight: 30, padding: "5px 10px" }} onClick={() => addLine("part")}><Plus size={13} /> Part</button>
              <button className="wb-btn-ghost" style={{ minHeight: 30, padding: "5px 10px" }} onClick={() => addLine("labour")}><Plus size={13} /> Labour</button>
            </div>
          )}

          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", fontSize: 12, marginTop: 10 }}>
            <label>
              VAT rate:{" "}
              <input type="number" step="0.1" className="wb-input" style={{ width: 55 }} value={vatRate} disabled={posted} onChange={(e) => setVatRate(e.target.value)} />%
            </label>
            <span>Subtotal: <strong>{money(totals.subtotal)}</strong></span>
            <span>VAT: <strong>{money(totals.vat)}</strong></span>
            <span>Total: <strong>{money(totals.total)}</strong></span>
            {!posted && <button className="wb-btn-ghost" style={{ minHeight: 30, padding: "5px 10px" }} onClick={saveLineItems}>Save changes</button>}
          </div>

          <div style={{ marginTop: 10 }}>
            <label className="wb-label">Notes</label>
            <textarea
              className="wb-input" style={{ width: "100%", minHeight: 50 }} value={notes} disabled={posted}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => updateQuoteField(quote.id, { notes })}
              placeholder="Notes to include on the quote (optional)"
            />
          </div>

          {quote.sourcePdfUrl ? (
            <a
              href={quote.sourcePdfUrl} target="_blank" rel="noreferrer"
              style={{ color: "var(--amber2)", fontSize: 12, marginTop: 10, display: "flex", alignItems: "center", gap: 4, width: "fit-content" }}
            >
              <FileText size={13} /> View source PDF
            </a>
          ) : (
            <>
              <button
                onClick={() => setShowScript((s) => !s)}
                style={{ background: "none", border: "none", color: "var(--amber2)", fontSize: 12, cursor: "pointer", marginTop: 10, display: "flex", alignItems: "center", gap: 4 }}
              >
                <FileText size={13} /> {showScript ? "Hide" : "View"} original script
              </button>
              {showScript && (
                <pre style={{ marginTop: 8, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, padding: 10, fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>
                  {quote.sourceScript}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function QuotesTab({ quotes, updateQuoteField, removeQuote }) {
  const [scriptText, setScriptText] = useState("");
  const [business, setBusiness] = useState(BUSINESSES[0]);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const generate = async () => {
    if (!scriptText.trim()) { setError("Paste the script first."); return; }
    setGenerating(true);
    setError("");
    setStatus("Reading the quote…");
    try {
      const res = await fetch("/api/office/quotes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptText, business }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Couldn't generate a quote from that"); setStatus(""); return; }
      setStatus("Quote generated below — review it before posting to Zoho.");
      setScriptText("");
    } catch {
      setError("Something went wrong — try again.");
      setStatus("");
    } finally {
      setGenerating(false);
    }
  };

  const uploadPdf = async (file) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are supported for upload.");
      return;
    }
    setGenerating(true);
    setError("");
    setStatus(`Reading ${file.name}…`);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch("/api/office/quotes/generate-from-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, base64, business }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Couldn't generate a quote from that PDF"); setStatus(""); return; }
      setStatus("Quote generated below — review it before posting to Zoho.");
    } catch {
      setError("Something went wrong — try again.");
      setStatus("");
    } finally {
      setGenerating(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const sorted = [...quotes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <ClipboardPaste size={16} color="var(--amber)" /> Paste a script
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
          Paste the quote a Claude or ChatGPT conversation drafted — parts, prices, labour — or upload a PDF (a
          supplier quote, a printed price sheet) instead. Either way it&apos;s turned into a structured quote with
          VAT worked out, ready to review and post to Zoho as an Estimate.
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <div>
            <label className="wb-label">Business</label>
            <select className="wb-input" style={{ width: 200 }} value={business} onChange={(e) => setBusiness(e.target.value)}>
              {BUSINESSES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>
        <textarea
          className="wb-input"
          style={{ width: "100%", minHeight: 140, fontFamily: "inherit" }}
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          placeholder="Paste the quote Claude or ChatGPT drafted here — parts, prices, labour, whatever it wrote"
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <button className="wb-btn" style={{ width: "auto" }} disabled={generating} onClick={generate}>
            {generating ? "Generating…" : "Generate quote"}
          </button>
          <label className="wb-btn-ghost" style={{ display: "inline-flex", width: "auto", cursor: generating ? "not-allowed" : "pointer", opacity: generating ? 0.5 : 1 }}>
            <Upload size={14} /> Upload a PDF instead
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              disabled={generating}
              style={{ display: "none" }}
              onChange={(e) => uploadPdf(e.target.files?.[0])}
            />
          </label>
          {status && <span style={{ color: "var(--green)", fontSize: 12, fontWeight: 700 }}>{status}</span>}
          {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
        </div>
      </div>

      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Quotes</div>
        {sorted.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0" }}>No quotes yet — paste a script above to generate one.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((q) => (
            <QuoteCard key={q.id} quote={q} updateQuoteField={updateQuoteField} removeQuote={removeQuote} />
          ))}
        </div>
      </div>
    </div>
  );
}
