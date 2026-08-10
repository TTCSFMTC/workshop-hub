"use client";

// Lets office ping a technician or the transport contact over WhatsApp with
// a booking's details pre-filled — same wa.me deep-link pattern used
// throughout WorkshopHub.jsx (whatsappLink/whatsappNumber), duplicated here
// rather than imported since this is a small, standalone component file.

const WORKSHOP_CONTACTS = [
  { name: "Ernesto", number: "447828512588" },
  { name: "Ervin", number: "447999992284" },
];

const TRANSPORT_CONTACT = { name: "Paul Jorgenson", number: "447469176707" };

function whatsappNumber(phone) {
  let digits = phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (digits.startsWith("0")) digits = "44" + digits.slice(1);
  else if (!digits.startsWith("44")) digits = "44" + digits;
  return digits;
}

function whatsappLink(phone, message) {
  return `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(message)}`;
}

const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};
const addDaysISO = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

function jobTypeLabel(booking, jobTypes) {
  const jt = jobTypes.find((j) => j.id === booking.jobTypeId);
  const extraJts = (booking.extraJobTypeIds || []).map((id) => jobTypes.find((j) => j.id === id)).filter(Boolean);
  return [jt?.name, ...extraJts.map((e) => e.name)].filter(Boolean).join(" + ") || "Not specified";
}

function buildWorkshopMessage(booking, jobTypes) {
  const requiredBy = booking.date ? addDaysISO(booking.date, (booking.days || 1) - 1) : "";
  return `New booking:
Business: ${booking.business || "-"}
Customer: ${booking.customerName || "-"}
Vehicle: ${[booking.vehicleModel, booking.reg].filter(Boolean).join(" ") || "N/A"}
Job: ${jobTypeLabel(booking, jobTypes)}
Booking date: ${booking.date ? fmtDate(booking.date) : "-"}
Required by: ${requiredBy ? fmtDate(requiredBy) : "-"}
Notes: ${booking.symptoms || "-"}`;
}

function buildTransportMessage(booking) {
  return `Transport request:
Business: ${booking.business || "-"}
Customer: ${booking.customerName || "-"}
Vehicle: ${[booking.vehicleModel, booking.reg].filter(Boolean).join(" ") || "N/A"}
Pickup address: ${booking.pickupAddress || "TBC"}
Needed by: ${booking.date ? fmtDate(booking.date) : "-"}
Notes: ${booking.symptoms || "-"}`;
}

export function BookingShareActions({ booking, jobTypes }) {
  if (!booking) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
      {WORKSHOP_CONTACTS.map((c) => (
        <a
          key={c.number}
          href={whatsappLink(c.number, buildWorkshopMessage(booking, jobTypes))}
          target="_blank" rel="noreferrer"
          style={{ fontSize: 11, color: "#25D366", border: "1px solid #1f4530", background: "#10281a", borderRadius: 20, padding: "3px 10px", textDecoration: "none" }}
        >
          Send to {c.name}
        </a>
      ))}
      <a
        href={whatsappLink(TRANSPORT_CONTACT.number, buildTransportMessage(booking))}
        target="_blank" rel="noreferrer"
        style={{ fontSize: 11, color: "#25D366", border: "1px solid #1f4530", background: "#10281a", borderRadius: 20, padding: "3px 10px", textDecoration: "none" }}
      >
        Send to {TRANSPORT_CONTACT.name} (transport)
      </a>
    </div>
  );
}
