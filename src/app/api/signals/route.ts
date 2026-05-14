import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { resolveBrandId } from "@/lib/brand-id";

type SignalRow = {
  id: string;
  brand_id: string;
  created_at: string;
  updated_at: string | null;
  mode?: "scalping" | "intraday" | null;
  action?: "buy" | "sell" | null;
  pair?: string | null;
  entry?: number | string | null;
  live_price?: number | string | null;
  stop_loss?: number | string | null;
  take_profit_1?: number | string | null;
  take_profit_2?: number | string | null;
  take_profit_3?: number | string | null;
  max_floating_pips?: number | string | null;
  status?: "active" | "closed" | null;
};

function asNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeSignal(row: SignalRow) {
  const entry = asNumber(row.entry);
  return {
    id: row.id,
    brand_id: row.brand_id,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    mode: row.mode === "intraday" ? "intraday" : "scalping",
    type: row.action === "sell" ? "sell" : "buy",
    pair: row.pair ?? "XAUUSD",
    entry_target: entry,
    live_price: asNumber(row.live_price, entry),
    sl: asNumber(row.stop_loss),
    tp1: asNumber(row.take_profit_1),
    tp2: asNumber(row.take_profit_2),
    tp3: row.take_profit_3 === null || row.take_profit_3 === undefined ? null : asNumber(row.take_profit_3),
    max_floating_pips:
      row.max_floating_pips === null || row.max_floating_pips === undefined
        ? null
        : asNumber(row.max_floating_pips),
    status: row.status === "active" ? "active" : "closed",
  };
}

export async function GET(req: NextRequest) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Server missing Supabase admin env vars" }, { status: 500 });
  }

  const brandId = resolveBrandId(req);
  const { searchParams } = new URL(req.url);
  const pair = (searchParams.get("pair") ?? "XAUUSD").trim().toUpperCase();
  const limitRaw = Number(searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  const { data, error } = await admin
    .from("signals")
    .select(
      "id,brand_id,created_at,updated_at,mode,action,pair,entry,live_price,stop_loss,take_profit_1,take_profit_2,take_profit_3,max_floating_pips,status",
    )
    .eq("brand_id", brandId)
    .eq("pair", pair)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: (data ?? []).map((row) => normalizeSignal(row as SignalRow)) });
}
