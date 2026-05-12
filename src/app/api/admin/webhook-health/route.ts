import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const nowMs = Date.now();
  const oneHourAgoIso = new Date(nowMs - 60 * 60 * 1000).toISOString();

  const [latestSignalRes, latestPerfRes, activeSignalsRes, recentSignalsRes] = await Promise.all([
    admin.from("signals").select("id,mode,type,status,created_at,updated_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("performance_logs").select("id,mode,type,outcome,created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("signals").select("id,mode", { count: "exact", head: true }).eq("status", "active"),
    admin.from("signals").select("id", { count: "exact", head: true }).gte("created_at", oneHourAgoIso),
  ]);

  if (latestSignalRes.error) return NextResponse.json({ error: latestSignalRes.error.message }, { status: 500 });
  if (latestPerfRes.error) return NextResponse.json({ error: latestPerfRes.error.message }, { status: 500 });
  if (activeSignalsRes.error) return NextResponse.json({ error: activeSignalsRes.error.message }, { status: 500 });
  if (recentSignalsRes.error) return NextResponse.json({ error: recentSignalsRes.error.message }, { status: 500 });

  const latestSignalAt = latestSignalRes.data?.updated_at ?? latestSignalRes.data?.created_at ?? null;
  const latestPerfAt = latestPerfRes.data?.created_at ?? null;

  const signalLagSeconds = latestSignalAt ? Math.max(0, Math.floor((nowMs - new Date(latestSignalAt).getTime()) / 1000)) : null;
  const perfLagSeconds = latestPerfAt ? Math.max(0, Math.floor((nowMs - new Date(latestPerfAt).getTime()) / 1000)) : null;

  return NextResponse.json({
    ok: true,
    data: {
      latest_signal: latestSignalRes.data ?? null,
      latest_performance: latestPerfRes.data ?? null,
      active_signal_count: activeSignalsRes.count ?? 0,
      signals_last_hour: recentSignalsRes.count ?? 0,
      signal_lag_seconds: signalLagSeconds,
      performance_lag_seconds: perfLagSeconds,
    },
  });
}

