import { NextResponse } from "next/server";
import { checkIngenium } from "@/lib/ingenium";

// Used by the public booking page to see whether a registration is a JLR
// Ingenium, which gets its own availability. Only ever returns the verdict and
// make — nothing else from the vehicle record.
export async function POST(request) {
  const body = await request.json().catch(() => null);
  const reg = (body?.reg || "").replace(/[^A-Za-z0-9]/g, "");
  if (reg.length < 2 || reg.length > 8) {
    return NextResponse.json({ error: "Please enter a valid registration." }, { status: 400 });
  }
  const result = await checkIngenium(reg);
  return NextResponse.json({ status: result.status, isIngenium: result.status === "yes", make: result.make || null });
}
