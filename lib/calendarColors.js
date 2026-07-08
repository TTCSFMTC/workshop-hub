// Google Calendar's fixed event colours (colorId 1-11). We only expose a
// handful of them as named options — the full Google palette has near-
// duplicates (e.g. two blues) that aren't worth the choice paralysis here.
export const CALENDAR_COLORS = [
  { id: "11", name: "Red", hex: "#d50000" },
  { id: "10", name: "Green", hex: "#0b8043" },
  { id: "7", name: "Blue", hex: "#039be5" },
  { id: "5", name: "Yellow", hex: "#f6bf26" },
  { id: "6", name: "Orange", hex: "#f4511e" },
  { id: "3", name: "Purple", hex: "#8e24aa" },
  { id: "4", name: "Pink", hex: "#e67c73" },
  { id: "8", name: "Grey", hex: "#616161" },
];

export function colorHex(colorId) {
  return CALENDAR_COLORS.find((c) => c.id === colorId)?.hex || "#616161";
}
