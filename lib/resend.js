import "server-only";

// Sends the distance customer approval-report email. Always sends from the
// verified warrington4x4.co.uk sending domain (the only one currently
// verified in Resend) but shows the correct business as the display name,
// so a Timing Chain Specialists customer still sees the right brand name
// even though the underlying domain is shared.

const API_KEY = process.env.RESEND_API_KEY;
const SEND_DOMAIN = "warrington4x4.co.uk";

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

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${business || "Workshop"} <noreply@${SEND_DOMAIN}>`,
      to: [to],
      subject: `Extra work found on your vehicle${reg ? ` (${reg})` : ""} — approval needed`,
      html,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend send failed: ${JSON.stringify(data)}`);
  return data;
}
