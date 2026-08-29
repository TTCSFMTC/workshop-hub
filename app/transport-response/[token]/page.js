import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTransportResponseNotification } from "@/lib/resend";

// Public, unauthenticated page reached from the Yes/No links in the
// transport request email — the random token is what scopes access to
// exactly one request, same pattern as /approve/[token] for customer job
// approvals. Deliberately a plain server-rendered page (no client
// component, no form) since a yes/no click needs nothing beyond what's
// already in the URL — unlike a customer's job approval, which needs a
// signature and so a real form.
//
// Recording the response here notifies office only (sendTransportResponseNotification)
// — the customer's own answer comes later from office deciding to
// accept/decline the booking request, never directly from this page.

const Shell = ({ children }) => (
  <div style={{ fontFamily: "-apple-system, Helvetica, Arial, sans-serif", maxWidth: 480, margin: "60px auto", padding: "0 20px", color: "#1a1a1a" }}>
    {children}
  </div>
);

export default async function TransportResponsePage({ params, searchParams }) {
  const { token } = await params;
  const { action } = await searchParams;

  if (!["approve", "decline"].includes(action)) {
    return <Shell><h2>Invalid link</h2><p>This link is missing a valid response — please use the Yes/No buttons from the email.</p></Shell>;
  }

  const { data: req, error } = await supabaseAdmin
    .from("booking_requests")
    .select("id, name, reg, business, date, transport_type, transport_status")
    .eq("transport_token", token)
    .maybeSingle();

  if (error || !req) {
    return <Shell><h2>Not found</h2><p>This request couldn't be found — it may have been removed.</p></Shell>;
  }

  if (req.transport_status !== "pending") {
    return (
      <Shell>
        <h2>Already responded to</h2>
        <p>This one's already been marked as {req.transport_status === "approved" ? "confirmed" : req.transport_status === "declined" ? "declined" : "not needing a response"} — no further action needed.</p>
      </Shell>
    );
  }

  const decision = action === "approve" ? "approved" : "declined";

  const { error: updateError } = await supabaseAdmin
    .from("booking_requests")
    .update({ transport_status: decision, transport_responded_at: new Date().toISOString() })
    .eq("id", req.id);

  if (updateError) {
    return <Shell><h2>Something went wrong</h2><p>Your response couldn't be saved — please try the link again, or contact the office directly.</p></Shell>;
  }

  try {
    await sendTransportResponseNotification({
      decision, name: req.name, reg: req.reg, business: req.business, date: req.date, transportType: req.transport_type,
    });
  } catch (e) {
    // Response is already saved — a failed office notification shouldn't
    // make this page look like it failed to transport.
    console.error("transport response notification failed", e);
  }

  return (
    <Shell>
      <h2 style={{ color: decision === "approved" ? "#1a7a3a" : "#b3261e" }}>
        {decision === "approved" ? "Thanks — marked as confirmed" : "Thanks — marked as declined"}
      </h2>
      <p>The office has been let know. No further action needed from you.</p>
    </Shell>
  );
}
