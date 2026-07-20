import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function requireSession() {
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function GET() {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("booking_requests")
    .select("*")
    .eq("status", "pending")
    .order("date", { ascending: true });
  if (error) {
    console.error("failed to list booking requests", error);
    return NextResponse.json({ error: "Failed to load requests" }, { status: 500 });
  }
  return NextResponse.json({ requests: data });
}

export async function PATCH(request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { id, status } = body || {};
  if (!id || !["converted", "declined"].includes(status)) {
    return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("booking_requests").update({ status }).eq("id", id);
  if (error) {
    console.error("failed to update booking request", error);
    return NextResponse.json({ error: "Failed to update request" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
