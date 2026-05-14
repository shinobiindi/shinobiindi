import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { resolveBrandId } from "@/lib/brand-id";

type CsvPerfRecord = {
  createdAtIso: string;
  mode: "scalping" | "intraday";
  type: "buy" | "sell";
  outcome: "tp1" | "tp2" | "tp3" | "be" | "sl";
  netPips: number;
  peakPips: number | null;
};

type PerfRow = {
  id: string;
  brand_id?: string;
  mode?: "scalping" | "intraday" | null;
  action?: "buy" | "sell" | null;
  type?: "buy" | "sell" | null;
  outcome: "tp1" | "tp2" | "tp3" | "be" | "sl";
  points?: number | string | null;
  net_pips?: number | string | null;
  peak_pips?: number | string | null;
  price?: number | string | null;
  created_at: string;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }

  out.push(cur);
  return out.map((x) => x.trim());
}

function parseAdminTimeToIso(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4}),\s*(\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyOrYyyy = Number(m[3]);
    const hh = Number(m[4]);
    const mi = Number(m[5]);
    const ss = Number(m[6]);

    const fullYear = String(m[3]).length === 4
      ? yyOrYyyy
      : (yyOrYyyy >= 70 ? 1900 + yyOrYyyy : 2000 + yyOrYyyy);

    const utcMs = Date.UTC(fullYear, mm - 1, dd, hh - 8, mi, ss);
    if (Number.isNaN(utcMs)) return null;
    return new Date(utcMs).toISOString();
  }

  const isoLike = text.match(/^\d{4}-\d{2}-\d{2}T/);
  if (!isoLike) return null;
  const isoTry = new Date(text);
  if (!Number.isNaN(isoTry.getTime())) return isoTry.toISOString();
  return null;
}

function toSecEpoch(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function roundPips(value: number | null, decimals = 1) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizePerf(row: PerfRow) {
  const net = row.net_pips ?? row.points ?? 0;
  const peak = row.peak_pips ?? row.points ?? null;
  const netValue = Number(net);
  const peakValue = peak === null ? null : Number(peak);
  return {
    ...row,
    type: row.type ?? row.action ?? "buy",
    net_pips: roundPips(Number.isFinite(netValue) ? netValue : 0) ?? 0,
    peak_pips: roundPips(peakValue),
    mode: row.mode ?? "scalping",
  };
}

function toMinuteBucket(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  return d.toISOString().slice(0, 16);
}

function dedupePerfRows(rows: ReturnType<typeof normalizePerf>[]) {
  const seen = new Set<string>();
  const out: ReturnType<typeof normalizePerf>[] = [];

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

const PERFORMANCE_EDIT_ENABLED = false;

export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
  const limit = 300;
  const queryLimit = 1200;

  const { data, error } = await admin
    .from("performance_logs")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(queryLimit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const normalized = (data ?? []).map((row) => normalizePerf(row as PerfRow));
  const deduped = dedupePerfRows(normalized).slice(0, limit);
  return NextResponse.json({ ok: true, data: deduped });
}

export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!PERFORMANCE_EDIT_ENABLED) {
    return NextResponse.json({ error: "Performance editing is managed in HQ for this brand." }, { status: 403 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
  const body = (await req.json()) as { csv?: string };
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv.trim()) {
    return NextResponse.json({ error: "csv is required" }, { status: 400 });
  }

  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV must include header and at least one row" }, { status: 400 });
  }

  const header = parseCsvLine(lines[0]).map((x) => x.toLowerCase());
  const idxTime = header.findIndex((h) => h === "time" || h === "created_at" || h === "timestamp");
  const idxMode = header.findIndex((h) => h === "mode");
  const idxType = header.findIndex((h) => h === "type" || h === "action");
  const idxOutcome = header.findIndex((h) => h === "outcome");
  const idxNet = header.findIndex((h) => h === "net pips" || h === "net_pips" || h === "points");
  const idxPeak = header.findIndex((h) => h === "peak pips" || h === "peak_pips");

  if ([idxTime, idxMode, idxType, idxOutcome, idxNet].some((i) => i < 0)) {
    return NextResponse.json(
      { error: "Missing required CSV columns. Required: Time, Mode, Type, Outcome, Net Pips (Peak Pips optional)." },
      { status: 400 },
    );
  }

  const parsed: CsvPerfRecord[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const createdAtIso = parseAdminTimeToIso(cols[idxTime] ?? "");
    const modeRaw = (cols[idxMode] ?? "").toLowerCase();
    const typeRaw = (cols[idxType] ?? "").toLowerCase();
    const outcomeRaw = (cols[idxOutcome] ?? "").toLowerCase();
    const netRaw = (cols[idxNet] ?? "").replace(/[^\d.-]/g, "");
    const peakRaw = idxPeak >= 0 ? (cols[idxPeak] ?? "").replace(/[^\d.-]/g, "") : "";

    const netPips = Number(netRaw);
    const peakPips = peakRaw === "" ? null : Number(peakRaw);

    const modeOk = modeRaw === "scalping" || modeRaw === "intraday";
    const typeOk = typeRaw === "buy" || typeRaw === "sell";
    const outcomeOk = ["tp1", "tp2", "tp3", "be", "sl"].includes(outcomeRaw);

    if (!createdAtIso || !modeOk || !typeOk || !outcomeOk || !Number.isFinite(netPips) || (peakPips !== null && !Number.isFinite(peakPips))) {
      skipped += 1;
      continue;
    }

    parsed.push({
      createdAtIso,
      mode: modeRaw as "scalping" | "intraday",
      type: typeRaw as "buy" | "sell",
      outcome: outcomeRaw as "tp1" | "tp2" | "tp3" | "be" | "sl",
      netPips,
      peakPips,
    });
  }

  if (!parsed.length) {
    return NextResponse.json({ error: "No valid CSV rows to import", skipped }, { status: 400 });
  }

  const { data: existing, error: existingError } = await admin
    .from("performance_logs")
    .select("id,created_at,mode,type:action")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  const byKey = new Map<string, Array<{ id: string; used: boolean }>>();
  for (const row of existing ?? []) {
    const r = row as { id: string; created_at: string; mode: string | null; type: string | null };
    const k = `${r.mode ?? "scalping"}|${r.type ?? "buy"}|${toSecEpoch(r.created_at)}`;
    const arr = byKey.get(k) ?? [];
    arr.push({ id: r.id, used: false });
    byKey.set(k, arr);
  }

  let updated = 0;
  let inserted = 0;

  for (const row of parsed) {
    const k = `${row.mode}|${row.type}|${toSecEpoch(row.createdAtIso)}`;
    const candidates = byKey.get(k) ?? [];
    const candidate = candidates.find((c) => !c.used);

    if (candidate) {
      const { error: upErr } = await admin
        .from("performance_logs")
        .update({
          mode: row.mode,
          action: row.type,
          outcome: row.outcome,
          points: row.netPips,
          net_pips: row.netPips,
          peak_pips: row.peakPips,
          created_at: row.createdAtIso,
        })
        .eq("brand_id", brandId)
        .eq("id", candidate.id);
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
      candidate.used = true;
      updated += 1;
      continue;
    }

    const { error: insErr } = await admin.from("performance_logs").insert({
      brand_id: brandId,
      pair: "XAUUSD",
      mode: row.mode,
      action: row.type,
      outcome: row.outcome,
      points: row.netPips,
      net_pips: row.netPips,
      peak_pips: row.peakPips,
      created_at: row.createdAtIso,
    });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    inserted += 1;
  }

  return NextResponse.json({ ok: true, imported: parsed.length, updated, inserted, skipped });
}

export async function DELETE(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!PERFORMANCE_EDIT_ENABLED) {
    return NextResponse.json({ error: "Performance editing is managed in HQ for this brand." }, { status: 403 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
  const body = (await req.json()) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string" && id.length > 0) : [];

  if (!ids.length) {
    return NextResponse.json({ error: "ids is required" }, { status: 400 });
  }

  const { error } = await admin.from("performance_logs").delete().eq("brand_id", brandId).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: ids.length });
}
