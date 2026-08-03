import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { generateOutstandingPartsPdf } from "@/lib/outstandingPartsPdf";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Turns the office's already-computed "outstanding parts" list (see
// outstandingPartsRows in WorkshopHub.jsx) into a downloadable PDF — same
// pattern as jobs-still-to-finish-pdf, just for stock on order rather than
// bookings.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.rows)) return NextResponse.json({ error: "rows is required" }, { status: 400 });

  try {
    const pdfBytes = await generateOutstandingPartsPdf({ rows: body.rows, generatedAt: body.generatedAt || new Date().toISOString() });
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="outstanding-parts.pdf"',
      },
    });
  } catch (e) {
    console.error("outstanding-parts-pdf failed", e);
    return NextResponse.json({ error: "Failed to generate the PDF" }, { status: 500 });
  }
}
