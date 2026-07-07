"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Wrong password.");
        setSubmitting(false);
        return;
      }
      router.replace(searchParams.get("from") || "/");
      router.refresh();
    } catch {
      setError("Something went wrong — try again.");
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#16181a", color: "#e7e3da", fontFamily: "ui-sans-serif, system-ui, sans-serif",
        padding: 20,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%", maxWidth: 320, background: "#1e2124", border: "1px solid #33383c",
          borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18 }}>Workshop Hub</div>
        <div style={{ fontSize: 13, color: "#9aa0a6" }}>Enter the shared password to continue.</div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          style={{
            background: "#25292c", border: "1px solid #33383c", color: "#e7e3da",
            borderRadius: 8, padding: "12px 12px", fontSize: 16,
          }}
        />
        {error && <div style={{ color: "#e2574c", fontSize: 13 }}>{error}</div>}
        <button
          type="submit"
          disabled={submitting || !password}
          style={{
            background: "#f5a623", color: "#1a1508", fontWeight: 700, border: "none",
            borderRadius: 8, padding: "12px 16px", fontSize: 14, cursor: "pointer",
            opacity: submitting || !password ? 0.6 : 1,
          }}
        >
          {submitting ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
