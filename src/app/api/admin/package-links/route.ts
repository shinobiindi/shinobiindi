import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { generateToken } from "@/lib/keygen";

export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const { data, error } = await admin.from("package_links").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const body = (await req.json()) as { package_name?: string; duration_days?: number; agent_name?: string };
  const duration = Number(body.duration_days ?? 0);
  if (!body.package_name || !duration || duration <= 0) {
    return NextResponse.json({ error: "package_name and duration_days are required" }, { status: 400 });
  }

  const MAX_RETRIES = 12;
  for (let i = 0; i < MAX_RETRIES; i += 1) {
    const token = generateToken(4);
    const { data, error } = await admin
      .from("package_links")
      .insert({
        token,
        package_name: body.package_name,
        duration_days: duration,
        agent_name: body.agent_name ?? null,
        is_active: true,
      })
      .select("*")
      .single();

    if (!error) return NextResponse.json({ ok: true, data });
    if (error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: "Token collision. Please retry." }, { status: 500 });
}
