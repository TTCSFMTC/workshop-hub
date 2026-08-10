const WORKSHOP_NUMBERS = [
  { name: "Guy 1", number: "447828512588" },
  { name: "Guy 2", number: "447999992284" },
];

const TRANSPORT_NUMBERS = {
  "warrington-4x4": "447469176707",
};

function buildWorkshopMessage(booking) {
  return (
    `New booking:\n` +
    `Customer: ${booking.customerName}\n` +
    `Vehicle: ${booking.vehicleReg || "N/A"}\n` +
    `Job: ${booking.jobDescription || "-"}\n` +
    `Date/Time: ${booking.date} ${booking.time}\n` +
    `Notes: ${booking.notes || "-"}`
  );
}

function buildTransportMessage(booking) {
  return (
    `Transport request:\n` +
    `Customer: ${booking.customerName}\n` +
    `Vehicle: ${booking.vehicleReg || "N/A"}\n` +
    `Pickup: ${booking.pickupAddress || "TBC"}\n` +
    `Drop-off: ${booking.dropoffAddress || "TBC"}\n` +
    `Time needed: ${booking.time}\n` +
    `Notes: ${booking.notes || "-"}`
  );
}

export function BookingShareActions({ booking, transportKey = "warrington-4x4" }) {
  function sendToPerson(number) {
    const message = buildWorkshopMessage(booking);
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank");
  }

  function sendToTransport() {
    const number = TRANSPORT_NUMBERS[transportKey];
    if (!number) {
      alert("No number set for this transport company.");
      return;
    }
    const message =
