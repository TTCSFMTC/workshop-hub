"use client";

import React, { useState, useMemo } from "react";
import { Upload, FileText, Mail, X, Check, Truck, AlertTriangle, Trash2 } from "lucide-react";
import { BUSINESSES } from "@/lib/constants";

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

// Loose match, not exact — "OCTANE LTD" vs "Octane Ltd." vs "Octane" should
// all line up. Good enough for scoping a stock-batch picker to "batches
// from roughly this supplier"; not used anywhere that needs to be exact.
const normalizeName = (name) => (name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function SupplierInvoicesTab({
  suppliers, addSupplier, updateSupplierField, removeSupplier,
  supplierInvoices, updateSupplierInvoiceField, removeSupplierInvoice,
  stockBatches, parts,
}) {
  const [uploadRows, setUploadRows] = useState([]); // [{ filename, status, error, matchedSupplier }]
  const [uploading, setUploading] = useState(false);
  const [postingId, setPostingId] = useState(null);
  const [newSupplier, setNewSupplier] = useState({ name: "", contactEmail: "", contactName: "" });
  const [missingSupplierId, setMissingSupplierId] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  const partName = (id) => parts.find((p) => p.id === id)?.name || "Unknown part";
  const supplierName = (id) => suppliers.find((s) => s.id === id)?.name || "";

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (files.length === 0) return;
    setUploadRows(files.map((f) => ({ filename: f.name, status: "pending" })));
    setUploading(true);
    for (let i = 0; i < files.length; i++) {
      setUploadRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "scanning" } : r)));
      try {
        const base64 = await fileToBase64(files[i]);
        const res = await fetch("/api/office/supplier-invoices/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: files[i].name, base64 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to scan");
        setUploadRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "done", matchedSupplier: data.matchedSupplier } : r)));
      } catch (e) {
        setUploadRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "error", error: e.message } : r)));
      }
    }
    setUploading(false);
  };

  const openInvoices = useMemo(
    () => supplierInvoices.filter((i) => i.status !== "posted").sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)),
    [supplierInvoices]
  );
  const postedInvoices = useMemo(
    () => supplierInvoices.filter((i) => i.status === "posted").sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)).slice(0, 20),
    [supplierInvoices]
  );

  // Every stock_batches id already claimed by some invoice — excluded from
  // the picker, and from the missing-invoices list below.
  const linkedBatchIds = useMemo(() => new Set(supplierInvoices.filter((i) => i.stockBatchId).map((i) => i.stockBatchId)), [supplierInvoices]);

  const batchesForSupplier = (supplierId) => {
    const sup = suppliers.find((s) => s.id === supplierId);
    if (!sup) return [];
    const normalized = normalizeName(sup.name);
    return stockBatches.filter((b) => b.status === "delivered" && normalizeName(b.supplier) === normalized);
  };

  const confirmInvoice = (inv) => {
    if (!inv.supplierId) { alert("Assign a supplier before confirming."); return; }
    updateSupplierInvoiceField(inv.id, { status: "confirmed", confirmedAt: new Date().toISOString() });
  };

  const postToZoho = async (inv) => {
    setPostingId(inv.id);
    try {
      const res = await fetch("/api/office/supplier-invoices/post-to-zoho", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: inv.id }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Failed to post to Zoho."); return; }
      updateSupplierInvoiceField(inv.id, { status: "posted", zohoBillId: data.billId, zohoBillNumber: data.billNumber });
    } catch {
      alert("Failed to post to Zoho — check your connection and try again.");
    }
    setPostingId(null);
  };

  const addSupplierClick = () => {
    if (!newSupplier.name.trim()) return;
    addSupplier(newSupplier.name.trim(), newSupplier.contactEmail.trim(), newSupplier.contactName.trim());
    setNewSupplier({ name: "", contactEmail: "", contactName: "" });
  };

  // Delivered batches for the chosen supplier with no invoice pointing at
  // them yet — this is the entire definition of "missing" (see the plan):
  // no separate statement upload, just whatever's been received but never
  // matched to a filed invoice.
  const missingItems = useMemo(() => {
    if (!missingSupplierId) return [];
    return batchesForSupplier(missingSupplierId)
      .filter((b) => !linkedBatchIds.has(b.id))
      .map((b) => ({ partName: partName(b.partId), qty: b.qtyOrdered, price: b.price, deliveredDate: b.deliveredAt ? fmtDate(b.deliveredAt.slice(0, 10)) : "—" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingSupplierId, stockBatches, linkedBatchIds, parts]);

  const emailMissing = async () => {
    const sup = suppliers.find((s) => s.id === missingSupplierId);
    if (!sup) return;
    if (!sup.contactEmail) { alert(`${sup.name} has no contact email set — add one in Suppliers below first.`); return; }
    setSendingEmail(true);
    try {
      const res = await fetch("/api/office/supplier-invoices/email-missing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: sup.contactEmail, supplierName: sup.name, items: missingItems }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Failed to send the email."); return; }
      alert(`Email sent to ${sup.contactEmail}.`);
    } catch {
      alert("Failed to send the email — check your connection and try again.");
    }
    setSendingEmail(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <Upload size={16} color="var(--amber)" /> Upload invoices
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
          Drop in as many PDF invoices as you like, mixed suppliers is fine — each one is scanned and filed below for you to check.
        </div>
        <label className="wb-btn" style={{ display: "inline-flex", width: "auto", cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? 0.5 : 1 }}>
          <Upload size={14} /> {uploading ? "Scanning…" : "Choose PDF files"}
          <input type="file" accept="application/pdf" multiple disabled={uploading} style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
        </label>
        {uploadRows.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {uploadRows.map((r, i) => (
              <div key={i} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  color: r.status === "done" ? "var(--green)" : r.status === "error" ? "var(--red)" : "var(--muted)",
                  fontWeight: 700, minWidth: 70,
                }}>
                  {r.status === "pending" ? "Waiting" : r.status === "scanning" ? "Scanning…" : r.status === "done" ? "Done" : "Failed"}
                </span>
                <span>{r.filename}</span>
                {r.matchedSupplier && <span style={{ color: "var(--muted)" }}>— matched to {r.matchedSupplier}</span>}
                {r.status === "error" && <span style={{ color: "var(--red)" }}>— {r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <FileText size={16} color="var(--amber)" /> Open invoices
        </div>
        {openInvoices.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0" }}>Nothing waiting on review.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {openInvoices.map((inv) => {
            const batches = inv.supplierId ? batchesForSupplier(inv.supplierId).filter((b) => !linkedBatchIds.has(b.id) || b.id === inv.stockBatchId) : [];
            return (
              <div key={inv.id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, background: "var(--panel2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{inv.vendorNameRaw || "Unknown vendor"}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {inv.invoiceNumber ? `Invoice ${inv.invoiceNumber} · ` : ""}{fmtDate(inv.invoiceDate)} · £{Number(inv.total).toFixed(2)}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <a href={inv.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--amber2)" }}>View PDF</a>
                    <button onClick={() => { if (confirm("Remove this invoice? This doesn't delete anything from Zoho.")) removeSupplierInvoice(inv.id); }} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
                  <div>
                    <label className="wb-label">Supplier</label>
                    <select className="wb-input" style={{ width: 180 }} value={inv.supplierId || ""} onChange={(e) => updateSupplierInvoiceField(inv.id, { supplierId: e.target.value || null, stockBatchId: null })}>
                      <option value="">Pick a supplier…</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="wb-label">Business (Zoho)</label>
                    <select className="wb-input" style={{ width: 170 }} value={inv.business} onChange={(e) => updateSupplierInvoiceField(inv.id, { business: e.target.value })}>
                      {BUSINESSES.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="wb-label">Matches which order?</label>
                    <select className="wb-input" style={{ width: 220 }} value={inv.stockBatchId || ""} onChange={(e) => updateSupplierInvoiceField(inv.id, { stockBatchId: e.target.value || null })} disabled={!inv.supplierId}>
                      <option value="">No matching order</option>
                      {batches.map((b) => <option key={b.id} value={b.id}>{partName(b.partId)} — {b.qtyOrdered} @ £{Number(b.price).toFixed(2)}</option>)}
                    </select>
                  </div>
                  <button className="wb-btn-ghost" style={{ minHeight: 36 }} disabled={!inv.supplierId || inv.status === "confirmed"} onClick={() => confirmInvoice(inv)}>
                    <Check size={13} /> {inv.status === "confirmed" ? "Confirmed" : "Confirm"}
                  </button>
                  <button className="wb-btn" style={{ minHeight: 36, width: "auto" }} disabled={inv.status !== "confirmed" || postingId === inv.id} onClick={() => postToZoho(inv)}>
                    {postingId === inv.id ? "Posting…" : "Post to Zoho"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {postedInvoices.length > 0 && (
        <div className="wb-panel">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Recently posted</div>
          <div style={{ overflowX: "auto" }}>
            <table className="wb-table">
              <thead><tr><th>Vendor</th><th>Invoice</th><th>Total</th><th>Business</th><th>Zoho bill</th></tr></thead>
              <tbody>
                {postedInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.vendorNameRaw || supplierName(inv.supplierId)}</td>
                    <td className="wh-mono">{inv.invoiceNumber || "—"}</td>
                    <td>£{Number(inv.total).toFixed(2)}</td>
                    <td>{inv.business}</td>
                    <td className="wh-mono">{inv.zohoBillNumber || inv.zohoBillId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={16} color="var(--amber)" /> Missing invoices
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
          Stock that's been delivered from a supplier but has no invoice filed against it yet.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "end", marginBottom: 12 }}>
          <div>
            <label className="wb-label">Supplier</label>
            <select className="wb-input" style={{ width: 220 }} value={missingSupplierId} onChange={(e) => setMissingSupplierId(e.target.value)}>
              <option value="">Pick a supplier…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button className="wb-btn-ghost" disabled={!missingSupplierId || missingItems.length === 0 || sendingEmail} onClick={emailMissing}>
            <Mail size={13} /> {sendingEmail ? "Sending…" : `Email supplier${missingItems.length > 0 ? ` (${missingItems.length})` : ""}`}
          </button>
        </div>
        {missingSupplierId && (
          <div style={{ overflowX: "auto" }}>
            <table className="wb-table">
              <thead><tr><th>Part</th><th>Qty</th><th>Price</th><th>Delivered</th></tr></thead>
              <tbody>
                {missingItems.map((item, i) => (
                  <tr key={i}><td>{item.partName}</td><td>{item.qty}</td><td>£{Number(item.price).toFixed(2)}</td><td>{item.deliveredDate}</td></tr>
                ))}
                {missingItems.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }}>Nothing outstanding for this supplier.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="wb-panel">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <Truck size={16} color="var(--amber)" /> Suppliers
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end", marginBottom: 14 }}>
          <div><label className="wb-label">Name</label><input className="wb-input" style={{ width: 160 }} value={newSupplier.name} onChange={(e) => setNewSupplier((f) => ({ ...f, name: e.target.value }))} /></div>
          <div><label className="wb-label">Contact email</label><input className="wb-input" style={{ width: 200 }} value={newSupplier.contactEmail} onChange={(e) => setNewSupplier((f) => ({ ...f, contactEmail: e.target.value }))} /></div>
          <div><label className="wb-label">Contact name</label><input className="wb-input" style={{ width: 160 }} value={newSupplier.contactName} onChange={(e) => setNewSupplier((f) => ({ ...f, contactName: e.target.value }))} /></div>
          <button className="wb-btn" style={{ width: "auto" }} disabled={!newSupplier.name.trim()} onClick={addSupplierClick}>Add supplier</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="wb-table">
            <thead><tr><th>Name</th><th>Contact email</th><th>Contact name</th><th></th></tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.contactEmail || "—"}</td>
                  <td>{s.contactName || "—"}</td>
                  <td><button onClick={() => { if (confirm(`Delete supplier "${s.name}"?`)) removeSupplier(s.id); }} title="Delete supplier" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><Trash2 size={14} /></button></td>
                </tr>
              ))}
              {suppliers.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No suppliers added yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
