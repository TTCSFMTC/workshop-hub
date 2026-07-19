"use client";

import { useEffect, useRef, useState } from "react";

// Standalone customer-facing page — deliberately not sharing state or
// styling with WorkshopHub.jsx, since this is reached by an unauthenticated
// customer from an emailed link, not logged into the internal app.
export default function ApprovalClient({ token }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [decision, setDecision] = useState(null); // "approved" | "declined" | null
  const [name, setName] = useState("");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [done, setDone] = useState(null); // "approved" | "declined" | null
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/approvals/${token}`);
        const data = await res.json();
        if (!res.ok) { setState({ loading: false, error: data.error || "Not found", data: null }); return; }
        setState({ loading: false, error: null, data });
        setName(data.customerName || "");
      } catch {
        setState({ loading: false, error: "Something went wrong loading this page.", data: null });
      }
    })();
  }, [token]);

  useEffect(() => {
    if (decision !== "approved") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio; canvas.height = 160 * ratio; ctx.scale(ratio, ratio);
    ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  }, [decision]);

  const getPos = (e) => { const canvas = canvasRef.current; const rect = canvas.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: p.clientX - rect.left, y: p.clientY - rect.top }; };
  const start = (e) => { e.preventDefault(); drawingRef.current = true; const ctx = canvasRef.current.getContext("2d"); const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => { if (!drawingRef.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setHasDrawn(true); };
  const end = () => { drawingRef.current = false; };
  const clearSig = () => { const canvas = canvasRef.current; canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); setHasDrawn(false); };

  const submit = async () => {
    setSubmitError(null);
    if (!name.trim()) { setSubmitError("Please enter your printed name."); return; }
    if (decision === "approved" && !hasDrawn) { setSubmitError("Please sign to approve."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/approvals/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          signatureName: name.trim(),
          signatureDataUrl: decision === "approved" ? canvasRef.current.toDataURL("image/png") : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error || "Failed to submit."); setSubmitting(false); return; }
      setDone(decision);
    } catch {
      setSubmitError("Something went wrong submitting your response.");
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f2ee", color: "#1a1a1a", fontFamily: "-apple-system, Helvetica, Arial, sans-serif", padding: "24px 16px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", background: "#fff", borderRadius: 14, padding: 28, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {state.loading && <p>Loading…</p>}
        {state.error && <p style={{ color: "#b3261e" }}>{state.error}</p>}

        {!state.loading && !state.error && state.data && (
          <>
            {done ? (
              <div>
                <h2 style={{ marginTop: 0 }}>{done === "approved" ? "Thanks — work approved" : "Thanks — we've noted you'd like to decline"}</h2>
                <p>{done === "approved" ? "We'll go ahead with the extra work and be in touch when it's done." : "We won't carry out the extra work. Your original job continues as booked."}</p>
              </div>
            ) : state.data.status !== "sent" ? (
              <div>
                <h2 style={{ marginTop: 0 }}>Already responded</h2>
                <p>
                  This request was already {state.data.status} by <strong>{state.data.customerSignatureName}</strong>
                  {state.data.respondedAt ? ` on ${new Date(state.data.respondedAt).toLocaleString("en-GB")}` : ""}.
                </p>
              </div>
            ) : (
              <div>
                <h2 style={{ marginTop: 0, marginBottom: 4 }}>Extra work found on your vehicle</h2>
                <p style={{ color: "#666", marginTop: 0 }}>{state.data.vehicleModel} {state.data.reg ? `— ${state.data.reg}` : ""}</p>
                <div style={{ background: "#f5f5f5", borderRadius: 8, padding: 16, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{state.data.aiWriteup}</div>
                <p style={{ fontSize: 20, fontWeight: 700, marginTop: 20 }}>£{Number(state.data.price).toFixed(2)}</p>
                {state.data.inStock
                  ? <p style={{ color: "#1a7a3a" }}>The part needed is already in stock — this can be done while your vehicle is still with us.</p>
                  : <p style={{ color: "#666" }}>This part isn't currently in stock and would need to be ordered.</p>}

                {!decision ? (
                  <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                    <button onClick={() => setDecision("approved")} style={{ flex: 1, background: "#f5a623", color: "#1a1508", fontWeight: 700, border: "none", borderRadius: 8, padding: "14px 0", fontSize: 15, cursor: "pointer" }}>Approve</button>
                    <button onClick={() => setDecision("declined")} style={{ flex: 1, background: "#eee", color: "#1a1a1a", fontWeight: 700, border: "none", borderRadius: 8, padding: "14px 0", fontSize: 15, cursor: "pointer" }}>Decline</button>
                  </div>
                ) : (
                  <div style={{ marginTop: 24 }}>
                    <label style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "#888", display: "block", marginBottom: 6 }}>Your printed name</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 12, border: "1px solid #ddd", borderRadius: 8, fontSize: 16, marginBottom: 16, boxSizing: "border-box" }} />

                    {decision === "approved" && (
                      <>
                        <label style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "#888", display: "block", marginBottom: 6 }}>Sign here to approve</label>
                        <canvas ref={canvasRef} style={{ width: "100%", height: 160, background: "#f5f5f5", border: "1px dashed #ccc", borderRadius: 8, touchAction: "none", marginBottom: 10 }}
                          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
                        <button onClick={clearSig} style={{ background: "none", border: "1px solid #ddd", borderRadius: 8, padding: "8px 14px", cursor: "pointer", marginBottom: 16 }}>Clear</button>
                      </>
                    )}

                    {submitError && <p style={{ color: "#b3261e" }}>{submitError}</p>}

                    <div style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => setDecision(null)} disabled={submitting} style={{ flex: 1, background: "#eee", border: "none", borderRadius: 8, padding: "14px 0", fontSize: 15, cursor: "pointer" }}>Back</button>
                      <button onClick={submit} disabled={submitting} style={{ flex: 2, background: decision === "approved" ? "#f5a623" : "#b3261e", color: decision === "approved" ? "#1a1508" : "#fff", fontWeight: 700, border: "none", borderRadius: 8, padding: "14px 0", fontSize: 15, cursor: "pointer", opacity: submitting ? 0.6 : 1 }}>
                        {submitting ? "Submitting…" : decision === "approved" ? "Confirm approval" : "Confirm decline"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
