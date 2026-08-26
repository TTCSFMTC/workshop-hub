import "server-only";

// Shared by both quote-generation routes (pasted script, uploaded PDF) —
// normalizes whatever line items Claude extracted into the shape the
// quotes table/UI expects, and derives subtotal/VAT/total from them rather
// than trusting the model's own arithmetic.
export function normalizeLineItems(rawLineItems) {
  return (rawLineItems || []).map((l) => ({
    type: l.type === "labour" ? "labour" : "part",
    description: l.description || "",
    quantity: l.quantity || 1,
    unit_price: l.unit_price ?? 0,
    amount: Math.round((l.quantity || 1) * (l.unit_price ?? 0) * 100) / 100,
  }));
}

export function computeQuoteTotals(lineItems, vatRate) {
  const subtotal = lineItems.reduce((sum, l) => sum + (l.quantity || 1) * (l.unit_price || 0), 0);
  const roundedSubtotal = Math.round(subtotal * 100) / 100;
  const vat = Math.round(roundedSubtotal * (vatRate / 100) * 100) / 100;
  return { subtotal: roundedSubtotal, vat, total: Math.round((roundedSubtotal + vat) * 100) / 100 };
}
