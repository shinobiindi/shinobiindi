import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { resolveBrandId } from "@/lib/brand-id";

type PerfRow = {
  id: string;
  created_at: string;
  mode?: "scalping" | "intraday" | null;
  action?: "buy" | "sell" | null;
  type?: "buy" | "sell" | null;
  outcome: "tp1" | "tp2" | "tp3" | "sl" | "be";
  points?: number | string | null;
  net_pips?: number | string | null;
  peak_pips?: number | string | null;
};

function normalizeLog(row: PerfRow) {
  const net = row.net_pips ?? row.points ?? 0;
  const peak = row.peak_pips ?? row.points ?? null;

  return {
    ...row,
    mode: row.mode ?? "scalping",
    type: row.type ?? row.action ?? "buy",
    net_pips: Number(net),
    peak_pips: peak === null || peak === undefined ? null : Number(peak),
  };
}

function toMinuteBucket(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  return d.toISOString().slice(0, 16);
}

function dedupeLogs(rows: ReturnType<typeof normalizeLog>[]) {
  const seen = new Set<string>();
  const out: ReturnType<typeof normalizeLog>[] = [];

  for (const row of rows) {
    const key = [
      toMinuteBucket(row.created_at),
      row.mode,
      row.type,
      row.outcome,
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

export async function GET(req: NextRequest) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Server missing Supabase admin env vars" }, { status: 500 });
  }

  const brandId = resolveBrandId(req);
  const { searchParams } = new URL(req.url);
  const limitRaw = Number(searchParams.get("limit") ?? "300");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 300;

  const queryLimit = Math.min(limit * 4, 2000);

  const { data, error } = await admin
    .from("performance_logs")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(queryLimit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const normalized = (data ?? []).map((row) => normalizeLog(row as PerfRow));
  const deduped = dedupeLogs(normalized).slice(0, limit);
  return NextResponse.json({ data: deduped });
}
