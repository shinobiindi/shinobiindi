import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { resolveBrandId } from "@/lib/brand-id";

type PerfRow = {
  id: string;
  action?: "buy" | "sell" | null;
  type?: "buy" | "sell" | null;
  points?: number | string | null;
  net_pips?: number | string | null;
  peak_pips?: number | string | null;
  outcome?: string | null;
};

function normalizePerf(row: PerfRow) {
  const net = row.net_pips ?? row.points ?? 0;
  const peak = row.peak_pips ?? row.points ?? null;
  return {
    ...row,
    type: row.type ?? row.action ?? "buy",
    net_pips: Number(net),
    peak_pips: peak === null ? null : Number(peak),
  };
}

const PERFORMANCE_EDIT_ENABLED = false;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!PERFORMANCE_EDIT_ENABLED) {
    return NextResponse.json({ error: "Performance editing is managed in HQ for this brand." }, { status: 403 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
  const { id } = await params;
  const body = (await req.json()) as {
    outcome?: "tp1" | "tp2" | "tp3" | "be" | "sl";
    net_pips?: number;
    peak_pips?: number | null;
    note?: string;
    actor?: string;
  };

  const { data: before } = await admin
    .from("performance_logs")
    .select("*")
    .eq("brand_id", brandId)
    .eq("id", id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "Log not found" }, { status: 404 });

  const patch: { outcome?: string; points?: number; net_pips?: number; peak_pips?: number | null } = {};
  if (body.outcome) patch.outcome = body.outcome;
  if (typeof body.net_pips === "number") {
    patch.points = body.net_pips;
    patch.net_pips = body.net_pips;
  }
  if (typeof body.peak_pips === "number" || body.peak_pips === null) patch.peak_pips = body.peak_pips;

  const { data, error } = await admin
    .from("performance_logs")
    .update(patch)
    .eq("brand_id", brandId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const audit = await admin.from("performance_log_edits").insert({
    performance_log_id: id,
    actor: body.actor ?? "admin",
    note: body.note ?? "manual adjustment",
    before_data: before,
    after_data: data,
  });

  if (audit.error) {
    await admin.from("performance_log_edits").insert({
      brand_id: brandId,
      log_id: id,
      previous_outcome: (before as { outcome?: string }).outcome ?? null,
      next_outcome: (data as { outcome?: string }).outcome ?? null,
      reason: body.note ?? "manual adjustment",
    });
  }

  return NextResponse.json({ ok: true, data: normalizePerf(data as PerfRow) });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!PERFORMANCE_EDIT_ENABLED) {
    return NextResponse.json({ error: "Performance editing is managed in HQ for this brand." }, { status: 403 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
  const { id } = await params;

  const { error } = await admin.from("performance_logs").delete().eq("brand_id", brandId).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
