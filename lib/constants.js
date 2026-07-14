// Shared between the Office booking form (components/WorkshopHub.jsx) and the
// public booking form (components/PublicBooking.jsx) so the two can't drift
// apart — these exact strings are also what's stored in bookings.business
// and booking_requests.business.
export const BUSINESSES = ["Warrington 4x4", "Timing Chain Specialists"];

// Each business has its own Google Business Profile, so its own review link
// — these must never cross over (a Warrington 4x4 customer must never be
// sent the Timing Chain Specialists link, or vice versa).
export const REVIEW_LINKS = {
  "Warrington 4x4": "https://g.page/r/CRXlnM2bo0QWEBM/review",
  "Timing Chain Specialists": "https://g.page/r/CfpGXmf60cxzEBM/review",
};

// Each business is a separate organization in Zoho Books — an invoice must
// always go to the matching one, never cross over between the two.
export const ZOHO_ORG_IDS = {
  "Warrington 4x4": "20115397353",
  "Timing Chain Specialists": "20116378916",
};

// One shared bank account across both businesses — included on every Zoho
// invoice's Customer Notes so customers know how to pay by transfer.
export const BANK_DETAILS = {
  accountName: "C Wilson T/A Warrington 4x4",
  sortCode: "04-00-05",
  accountNumber: "32107484",
};
