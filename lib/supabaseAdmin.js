import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses Row Level Security entirely. Only ever
// import this from server-side code (Route Handlers, never a "use client"
// file) so the key can't end up in the browser bundle. The `server-only`
// import above makes that a build error if it's ever imported from a client
// component, rather than a silent leak.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.warn(
    "SUPABASE_SERVICE_ROLE_KEY is missing — set it in .env.local (Project Settings -> API -> secret key)"
  );
}

export const supabaseAdmin = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  serviceRoleKey || "placeholder-service-role-key",
  { auth: { persistSession: false } }
);
