import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { generateStillToFinishPdf } from "@/lib/stillToFinishPdf";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// Turns the office's already-computed "jobs still to finish" list (see
// stillToFinishRows in WorkshopHub.jsx) into a downloadable PDF — the
// print button covers the reception printer, this covers sending the same
// list to a technician over WhatsApp or email instead.
export async function POST(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.rows)) return NextResponse.json({ error: "rows is required" }, { status: 400 });

  try {
    const pdfBytes = await generateStillToFinishPdf({ rows: body.rows, generatedAt: body.generatedAt || new Date().toISOString() });
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="jobs-still-to-finish.pdf"',
      },
    });
  } catch (e) {
    console.error("jobs-still-to-finish-pdf failed", e);
    return NextResponse.json({ error: "Failed to generate the PDF" }, { status: 500 });
  }
}
