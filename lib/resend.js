import "server-only";

// Transactional emails. Always sends from the
// verified warrington4x4.co.uk sending domain (the only one currently
// verified in Resend) but shows the correct business as the display name,
// so a Timing Chain Specialists customer still sees the right brand name
// even though the underlying domain is shared.

const API_KEY = process.env.RESEND_API_KEY;
const SEND_DOMAIN = "warrington4x4.co.uk";
const OFFICE_NOTIFICATION_EMAIL = process.env.OFFICE_NOTIFICATION_EMAIL;

async function sendEmail({ from, to, cc, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], ...(cc ? { cc: [cc] } : {}), subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend send failed: ${JSON.stringify(data)}`);
  return data;
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

// Fired the moment a customer submits a public booking request — without
// this, a request just sat in booking_requests with nobody notified, which
// was the whole reason the public booking form wasn't genuinely part of
// the day-to-day process yet.
export async function sendBookingRequestNotification({ name, business, phone, email, reg, date, requirements, needsReview, isEmergency, otherDetails, isNonRunner, symptoms, transportType, estimatedDays }) {
  if (!OFFICE_NOTIFICATION_EMAIL) return;
  const heading = isEmergency ? "EMERGENCY booking request" : needsReview ? "New booking request — worth a closer look" : "New booking request";
  const transportLabel = transportType === "collect_deliver" ? "Collect & deliver" : transportType === "collect" ? "Collect only" : null;
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px; ${isEmergency ? "color: #b3261e;" : ""}">${heading}</h2>
      <p style="color: #555; margin-top: 0;">${business || "Workshop"} — requested for ${date}</p>
      <p><strong>${name || "Customer"}</strong> — ${phone || "no phone given"}${email ? ` — ${email}` : ""}${reg ? ` — ${reg}` : ""}</p>
      ${isNonRunner ? '<p style="color: #b3261e; font-weight: bold;">NON-RUNNER</p>' : ""}
      <p>${(requirements || []).join(", ") || "No requirements specified"}</p>
      ${transportLabel ? `<p style="color: #b8860b; font-weight: bold;">${transportLabel} requested (${estimatedDays || "?"} days total) — transport contact has been emailed for a yes/no, you'll get a separate email once they reply.</p>` : ""}
      ${symptoms ? `<p style="background: #f5f5f5; border-radius: 8px; padding: 12px; white-space: pre-wrap;"><strong>Symptoms:</strong> ${symptoms}</p>` : ""}
      ${otherDetails ? `<p style="background: #f5f5f5; border-radius: 8px; padding: 12px; white-space: pre-wrap;">${otherDetails}</p>` : ""}
      <p style="color: #888; font-size: 13px;">Review it under Office → Booking Requests in Workshop Hub.</p>
    </div>
  `;
  return sendEmail({
    from: `Workshop Hub <noreply@${SEND_DOMAIN}>`,
    to: OFFICE_NOTIFICATION_EMAIL,
    subject: `${isEmergency ? "EMERGENCY: " : ""}New booking request: ${name || "Customer"}${reg ? ` (${reg})` : ""} — ${date}`,
    html,
  });
}

// Fired right after a Timing Chain Specialists chain-job request asks for
// collection and/or delivery — goes to the transport contact (never the
// customer) with a one-click yes/no. Their click lands on a public,
// token-scoped page that records the answer and notifies office only (see
// sendTransportResponseNotification) — the customer only ever hears the
// final word from office once they've made their own accept/decline call.
export async function sendTransportRequestEmail({ to, transportContactName, name, reg, address, business, date, transportType, estimatedDays, approveUrl, declineUrl }) {
  if (!to) return;
  const label = transportType === "collect_deliver" ? "Collect and deliver" : "Collect only";
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">Vehicle collection request</h2>
      <p style="color: #555; margin-top: 0;">${business || "Workshop"} — job date ${date}</p>
      <p>Hi ${transportContactName || "there"},</p>
      <p>Can you fit this one in?</p>
      <div style="background: #f5f5f5; border-radius: 8px; padding: 16px;">
        <p style="margin: 0 0 6px;"><strong>${label}</strong> — ${estimatedDays || "?"} days total</p>
        <p style="margin: 0 0 6px;">Customer: ${name || ""}</p>
        <p style="margin: 0 0 6px;">Registration: ${reg || ""}</p>
        <p style="margin: 0;">Pickup address: ${address || "(not given — check with office)"}</p>
      </div>
      <p style="text-align: center; margin: 28px 0;">
        <a href="${approveUrl}" style="background: #5fb87a; color: #0b1a10; font-weight: bold; padding: 14px 28px; border-radius: 8px; text-decoration: none; display: inline-block; margin-right: 10px;">Yes, I can do this</a>
        <a href="${declineUrl}" style="background: #e2574c; color: #2a0b08; font-weight: bold; padding: 14px 28px; border-radius: 8px; text-decoration: none; display: inline-block;">No, can't fit it in</a>
      </p>
      <p style="color: #888; font-size: 13px;">This just lets the office know — they'll confirm the actual booking with the customer.</p>
    </div>
  `;
  return sendEmail({
    from: `Workshop Hub <noreply@${SEND_DOMAIN}>`,
    to,
    subject: `Collection request: ${name || "Customer"}${reg ? ` (${reg})` : ""} — ${date}`,
    html,
  });
}

// Fired the moment transport clicks yes/no on the email above — goes to
// office only, same reasoning as sendApprovalResponseNotification: the
// customer's own answer comes from office deciding to accept/decline the
// booking request, not from transport's reply directly.
export async function sendTransportResponseNotification({ decision, name, reg, business, date, transportType }) {
  if (!OFFICE_NOTIFICATION_EMAIL) return;
  const approved = decision === "approved";
  const label = transportType === "collect_deliver" ? "collect & deliver" : "collect";
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px; color: ${approved ? "#1a7a3a" : "#b3261e"};">${approved ? "Transport confirmed" : "Transport declined"} the collection</h2>
      <p style="color: #555; margin-top: 0;">${business || "Workshop"} — ${name || "Customer"}${reg ? ` (${reg})` : ""} — ${date}</p>
      <p>Transport ${approved ? "can" : "can't"} ${label} this vehicle. ${approved ? "You can go ahead and confirm the booking with the customer." : "You'll need to find another way to get the vehicle in, or check with the customer about dropping it off themselves."}</p>
      <p style="color: #888; font-size: 13px;">Review it under Office → Booking Requests in Workshop Hub.</p>
    </div>
  `;
  return sendEmail({
    from: `Workshop Hub <noreply@${SEND_DOMAIN}>`,
    to: OFFICE_NOTIFICATION_EMAIL,
    subject: `Transport ${approved ? "confirmed" : "declined"}: ${name || "Customer"}${reg ? ` (${reg})` : ""} — ${date}`,
    html,
  });
}

// Fired by a one-click "Customer no-show" button on the booking when a
// customer simply doesn't turn up for their slot — a fast, consistent way to
// check in and give them an easy path back in touch, rather than office
// having to find time to call.
export async function sendNoShowEmail({ to, business, customerName }) {
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">We were expecting you today</h2>
      <p>Hi ${customerName || "there"},</p>
      <p>We were expecting you today for your booked-in appointment, but it looks like you haven't managed to make it in.</p>
      <p>I'm sorry if there's been an issue — please contact us straight away on <strong>07880 005914</strong> or email us at <strong>warrington4x4@gmail.com</strong> so we can get you sorted with a new time.</p>
      <p>Many thanks,<br>${business || "Workshop"}</p>
    </div>
  `;
  return sendEmail({
    from: `${business || "Workshop"} <noreply@${SEND_DOMAIN}>`,
    to,
    subject: "We were expecting you today",
    html,
  });
}

// The customer's copy of their signed vehicle handover/collection
// confirmation — mirrors sendIntakeConfirmationEmail's shape but for the
// other end of the job (collection, not drop-off).
export async function sendHandoverConfirmationEmail({ to, business, customerName, reg, pdfUrl }) {
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">Your vehicle handover confirmation</h2>
      <p style="color: #555; margin-top: 0;">${reg || ""}</p>
      <p>Hi ${customerName || "there"},</p>
      <p>Thanks for collecting your vehicle — here's a copy of what was confirmed:</p>
      <p style="text-align: center; margin: 28px 0;">
        <a href="${pdfUrl}" style="background: #f5a623; color: #1a1508; font-weight: bold; padding: 14px 28px; border-radius: 8px; text-decoration: none; display: inline-block;">View your confirmation (PDF)</a>
      </p>
      <p style="color: #888; font-size: 13px;">This link is private to you — please don't share it.</p>
    </div>
  `;
  return sendEmail({
    from: `${business || "Workshop"} <noreply@${SEND_DOMAIN}>`,
    to,
    subject: `Your vehicle handover confirmation${reg ? ` (${reg})` : ""}`,
    html,
  });
}

// Sent at month end (or whenever office runs the reconciliation check) to
// chase a supplier for invoices covering stock that's already been
// delivered but never had an invoice filed against it — see the Missing
// Invoices section of the Supplier Invoices tab.
export async function sendMissingInvoicesEmail({ to, supplierName, items }) {
  const rows = (items || [])
    .map((i) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${i.partName}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${i.qty}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">£${Number(i.price).toFixed(2)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${i.deliveredDate || "-"}</td></tr>`)
    .join("");
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">Invoices needed</h2>
      <p>Hi ${supplierName || "there"},</p>
      <p>Could you send over invoices (or your latest statement) for the following, please? We have these as delivered but don't have a matching invoice on file yet:</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 16px 0;">
        <thead><tr>
          <th style="text-align:left; padding:6px 10px; border-bottom:2px solid #333;">Part</th>
          <th style="text-align:left; padding:6px 10px; border-bottom:2px solid #333;">Qty</th>
          <th style="text-align:left; padding:6px 10px; border-bottom:2px solid #333;">Price</th>
          <th style="text-align:left; padding:6px 10px; border-bottom:2px solid #333;">Delivered</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p>Thanks very much,<br>Workshop Hub</p>
    </div>
  `;
  return sendEmail({
    from: `Workshop Hub <noreply@${SEND_DOMAIN}>`,
    to,
    subject: `Invoices needed — ${(items || []).length} item${(items || []).length === 1 ? "" : "s"} outstanding`,
    html,
  });
}

// Weekly "what's coming in" list for the engine-parts supplier — just
// registration, make/model and the job (no customer details, prices or exact
// dates), split into this week and next so parts can be lined up in advance.
// `weeks` is [{ title, jobs: [{ reg, vehicle, job }] }].
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export async function sendLecWeeklyJobsEmail({ to, cc, weeks, total, testNote, first, heldFrom, upTo }) {
  const fmtD = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const th = 'style="text-align:left;padding:6px 10px;border-bottom:2px solid #333;"';
  const td = 'style="padding:6px 10px;border-bottom:1px solid #eee;"';
  const sections = weeks.map((w) => `
      <h3 style="margin:22px 0 4px;">${esc(w.title)}</h3>
      ${w.jobs.length === 0 ? '<p style="color:#666;margin:6px 0;">Nothing booked yet.</p>' : `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr><th ${th}>Registration</th><th ${th}>Make &amp; model</th><th ${th}>Job</th></tr></thead>
        <tbody>${w.jobs.map((j) => `<tr><td ${td}><strong>${esc(j.reg)}</strong></td><td ${td}>${esc(j.vehicle)}</td><td ${td}>${esc(j.job)}</td></tr>`).join("")}</tbody>
      </table>`}`).join("");
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #1a1a1a;">
      ${testNote ? `<p style="background:#fff3cd;padding:8px 12px;border-radius:6px;">${esc(testNote)}</p>` : ""}
      <h2 style="margin-bottom: 4px;">Jobs coming in — next two weeks</h2>
      <p style="margin-top:0;">Hi Roxanne, ${first ? "it's the start of the month — here's" : "here's"} what we have booked in for the next two weeks (${total} job${total === 1 ? "" : "s"}), so you can see what parts we're likely to need:</p>
      ${upTo ? `<p style="background:#f4f4f4;padding:8px 12px;border-radius:6px;font-size:13px;">This list runs up to ${esc(fmtD(upTo))} only — jobs from ${esc(fmtD(heldFrom))} will follow in the email on the 1st.</p>` : ""}
      ${sections}
      <p style="margin-top:22px;color:#666;font-size:12px;">Bookings can change — this list is sent automatically every Saturday (and on the 1st of each month).</p>
      <p>Thanks very much,<br>Chris<br>Warrington 4x4 / Timing Chain Specialists<br>Unit 27 Tatton Court, Woolston, Warrington WA1 4RR</p>
    </div>
  `;
  return sendEmail({
    from: `Warrington 4x4 <noreply@${SEND_DOMAIN}>`,
    to,
    cc,
    subject: `Jobs coming in over the next two weeks (${total} job${total === 1 ? "" : "s"})`,
    html,
  });
}

// Instant heads-up when a job is added (or confirmed / moved) inside the next
// two weeks, so the weekly list never goes stale.
export async function sendLecNewJobEmail({ to, cc, job, kind }) {
  const lead = kind === "moved" ? "A job has just been moved into the next two weeks" : kind === "confirmed" ? "A booking has just been confirmed" : "We've just taken another booking";
  const td = 'style="padding:6px 10px;border-bottom:1px solid #eee;"';
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">Another job booked in</h2>
      <p>Hi Roxanne, ${esc(lead)} for ${esc(job.when)}:</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0;">
        <tbody><tr><td ${td}><strong>${esc(job.reg)}</strong></td><td ${td}>${esc(job.vehicle)}</td><td ${td}>${esc(job.job)}</td></tr></tbody>
      </table>
      <p style="color:#666;font-size:12px;">This is in addition to the weekly list we sent on Saturday.</p>
      <p>Thanks very much,<br>Chris<br>Warrington 4x4 / Timing Chain Specialists<br>Unit 27 Tatton Court, Woolston, Warrington WA1 4RR</p>
    </div>
  `;
  return sendEmail({
    from: `Warrington 4x4 <noreply@${SEND_DOMAIN}>`,
    to,
    cc,
    subject: `Another job booked: ${job.reg} — ${job.vehicle}`,
    html,
  });
}
