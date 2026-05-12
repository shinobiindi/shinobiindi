import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const { id } = await params;
  const body = (await req.json()) as {
    outcome?: "tp1" | "tp2" | "tp3" | "be" | "sl";
    net_pips?: number;
    peak_pips?: number | null;
    note?: string;
    actor?: string;
  };

  const { data: before } = await admin.from("performance_logs").select("*").eq("id", id).maybeSingle();
  if (!before) return NextResponse.json({ error: "Log not found" }, { status: 404 });

  const patch: { outcome?: string; net_pips?: number; peak_pips?: number | null } = {};
  if (body.outcome) patch.outcome = body.outcome;
  if (typeof body.net_pips === "number") patch.net_pips = body.net_pips;
  if (typeof body.peak_pips === "number" || body.peak_pips === null) patch.peak_pips = body.peak_pips;

  const { data, error } = await admin.from("performance_logs").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("performance_log_edits").insert({
    performance_log_id: id,
    actor: body.actor ?? "admin",
    note: body.note ?? "manual adjustment",
    before_data: before,
    after_data: data,
  });

  return NextResponse.json({ ok: true, data });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const { id } = await params;

  const { error } = await admin.from("performance_logs").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
