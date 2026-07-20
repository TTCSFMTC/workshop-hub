import "server-only";

// Sends the distance customer approval-report email. Always sends from the
// verified warrington4x4.co.uk sending domain (the only one currently
// verified in Resend) but shows the correct business as the display name,
// so a Timing Chain Specialists customer still sees the right brand name
// even though the underlying domain is shared.

const API_KEY = process.env.RESEND_API_KEY;
const SEND_DOMAIN = "warrington4x4.co.uk";
const OFFICE_NOTIFICATION_EMAIL = process.env.OFFICE_NOTIFICATION_EMAIL;

async function sendEmail({ from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend send failed: ${JSON.stringify(data)}`);
  return data;
}

export async function sendApprovalEmail({ to, business, customerName, reg, vehicleModel, writeup, price, inStock, approveUrl }) {
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">Extra work found on your vehicle</h2>
      <p style="color: #555; margin-top: 0;">${vehicleModel || "Vehicle"} — ${reg || ""}</p>
      <p>Hi ${customerName || "there"},</p>
      <p>While working on your vehicle, our technician found the following:</p>
      <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; white-space: pre-wrap;">${writeup}</div>
      <p style="font-size: 18px; font-weight: bold; margin-top: 20px;">Price for this extra work: £${Number(price).toFixed(2)}</p>
      ${inStock ? '<p style="color: #1a7a3a;">The part needed is already in stock, so this can be completed while your vehicle is still with us.</p>' : '<p>This part isn\'t currently in stock and would need to be ordered.</p>'}
      <p>Please let us know whether you'd like us to go ahead:</p>
      <p style="text-align: center; margin: 28px 0;">
        <a href="${approveUrl}" style="background: #f5a623; color: #1a1508; font-weight: bold; padding: 14px 28px; border-radius: 8px; text-decoration: none; display: inline-block;">Review and respond</a>
      </p>
      <p style="color: #888; font-size: 13px;">If the button doesn't work, copy and paste this link into your browser: ${approveUrl}</p>
    </div>
  `;

  return sendEmail({
    from: `${business || "Workshop"} <noreply@${SEND_DOMAIN}>`,
    to,
    subject: `Extra work found on your vehicle${reg ? ` (${reg})` : ""} — approval needed`,
    html,
  });
}

// The customer's copy of their vehicle drop-off confirmation — a private
// Drive link to the signed PDF, and to the condition video if one was
// uploaded.
export async function sendIntakeConfirmationEmail({ to, business, customerName, reg, pdfUrl, videoUrl }) {
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">Your vehicle drop-off confirmation</h2>
      <p style="color: #555; margin-top: 0;">${reg || ""}</p>
      <p>Hi ${customerName || "there"},</p>
      <p>Thanks for dropping your vehicle off with us — here's a copy of what was confirmed:</p>
      <p style="text-align: center; margin: 28px 0;">
        <a href="${pdfUrl}" style="background: #f5a623; color: #1a1508; font-weight: bold; padding: 14px 28px; border-radius: 8px; text-decoration: none; display: inline-block;">View your confirmation (PDF)</a>
      </p>
      ${videoUrl ? `<p style="text-align: center;"><a href="${videoUrl}" style="color: #1a1a1a;">View the drop-off video</a></p>` : ""}
      <p style="color: #888; font-size: 13px;">These links are private to you — please don't share them.</p>
    </div>
  `;
  return sendEmail({
    from: `${business || "Workshop"} <noreply@${SEND_DOMAIN}>`,
    to,
    subject: `Your vehicle drop-off confirmation${reg ? ` (${reg})` : ""}`,
    html,
  });
}

// Fired the moment a customer approves or declines extra work on the public
// /approve page — without this, office had no way to know a response had
// come in short of reopening the job card and checking.
export async function sendApprovalResponseNotification({ business, customerName, reg, vehicleModel, decision, price, signatureName }) {
  if (!OFFICE_NOTIFICATION_EMAIL) return;
  const approved = decision === "approved";
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px; color: ${approved ? "#1a7a3a" : "#b3261e"};">${approved ? "Customer approved the extra work" : "Customer declined the extra work"}</h2>
      <p style="color: #555; margin-top: 0;">${business || "Workshop"} — ${vehicleModel || "Vehicle"} ${reg ? `(${reg})` : ""}</p>
      <p><strong>${customerName || "Customer"}</strong> ${approved ? "approved" : "declined"} the £${Number(price).toFixed(2)} extra work request, signed as "${signatureName}".</p>
    </div>
  `;
  return sendEmail({
    from: `Workshop Hub <noreply@${SEND_DOMAIN}>`,
    to: OFFICE_NOTIFICATION_EMAIL,
    subject: `${approved ? "Approved" : "Declined"}: extra work${reg ? ` on ${reg}` : ""}`,
    html,
  });
}
