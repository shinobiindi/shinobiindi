import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type Incoming = {
  secret?: string;
  event?: "signal" | "price_update" | "signal_closed";
  pair?: string;
  symbol?: string;
  mode?: "scalping" | "intraday";
  strategy?: "scalping" | "intraday";
  type?: "buy" | "sell";
  side?: "buy" | "sell";
  entry_target?: number | string;
  entry?: number | string;
  live_price?: number | string;
  price?: number | string;
  sl?: number | string;
  stop_loss?: number | string;
  tp1?: number | string;
  tp2?: number | string;
  tp3?: number | string;
  outcome?: "tp1" | "tp2" | "tp3" | "be" | "sl";
  close_price?: number | string;
  status?: "active" | "closed";
};

const GOLD_PIPS_MULTIPLIER = 10;
const SIGNAL_DUPLICATE_COOLDOWN_SECONDS = Number(process.env.SIGNAL_DUPLICATE_COOLDOWN_SECONDS ?? "90");
const BE_REVERSAL_PIPS = Number(process.env.BE_REVERSAL_PIPS ?? "20");
const SL_MAX_PROGRESS_PIPS = Number(process.env.SL_MAX_PROGRESS_PIPS ?? "10");

async function sendTelegramTradingAlert(lines: string[]) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join("\n"),
        parse_mode: "Markdown",
      }),
    });
  } catch {
    // do not block webhook flow on alert failure
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalized(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return v.length ? v : null;
}

function resolveBrandId(request: NextRequest): string {
  const fromEnv = (process.env.BRAND_ID ?? process.env.NEXT_PUBLIC_BRAND_ID ?? "").trim().toLowerCase();
  if (fromEnv) return fromEnv;

  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").trim().toLowerCase();
  if (!host) return "";

  if (host.includes("kafra")) return "kafra";
  if (host.includes("sarjan")) return "sarjan";
  if (host.includes("richjoker")) return "richjoker";
  if (host.includes("shinobi")) return "shinobi";
  return "";
}

function inferHitOutcome(args: {
  type: "buy" | "sell";
  livePrice: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number | null;
}): "tp1" | "tp2" | "tp3" | "sl" | null {
  const { type, livePrice, sl, tp1, tp2, tp3 } = args;
  if (type === "buy") {
    if (livePrice <= sl) return "sl";
    if (tp3 !== null && livePrice >= tp3) return "tp3";
    if (livePrice >= tp2) return "tp2";
    if (livePrice >= tp1) return "tp1";
    return null;
  }
  if (livePrice >= sl) return "sl";
  if (tp3 !== null && livePrice <= tp3) return "tp3";
  if (livePrice <= tp2) return "tp2";
  if (livePrice <= tp1) return "tp1";
  return null;
}

function classifyCycleOutcome(args: {
  type: "buy" | "sell";
  entryTarget: number;
  closePrice: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number | null;
  peakPips: number;
}): "tp1" | "tp2" | "tp3" | "be" | "sl" {
  const immediateHit = inferHitOutcome({
    type: args.type,
    livePrice: args.closePrice,
    sl: args.sl,
    tp1: args.tp1,
    tp2: args.tp2,
    tp3: args.tp3,
  });

  if (immediateHit === "tp1" || immediateHit === "tp2" || immediateHit === "tp3") {
    return immediateHit;
  }

  if (immediateHit === "sl") {
    // If signal never built >10 pips before SL, keep it as SL.
    if (args.peakPips <= SL_MAX_PROGRESS_PIPS) return "sl";
    // If it did build profit but failed to reach 20 pips, classify as BE.
    if (args.peakPips < BE_REVERSAL_PIPS) return "be";
    // If it had meaningful run-up and later reversed to SL, treat as BE protection logic.
    return "be";
  }

  const realizedPips =
    args.type === "buy"
      ? (args.closePrice - args.entryTarget) * GOLD_PIPS_MULTIPLIER
      : (args.entryTarget - args.closePrice) * GOLD_PIPS_MULTIPLIER;

  // Reversal/non-TP closure before 20 pips peak -> BE
  if (args.peakPips < BE_REVERSAL_PIPS && realizedPips <= 0) return "be";
  // Non-TP/non-SL closure after meaningful run but reversed -> BE
  if (realizedPips <= 0) return "be";
  // Fallback positive close without explicit TP touch.
  return "tp1";
}

function computeStoredNetPips(args: {
  outcome: "tp1" | "tp2" | "tp3" | "be" | "sl";
  realizedPips: number;
  peakPips: number;
}) {
  if (args.outcome === "be") {
    // SHINOBI INDI policy: BE stores 85% of achieved peak run-up.
    return Number(Math.max(0, args.peakPips * 0.85).toFixed(1));
  }
  return Number(Math.max(args.realizedPips, args.peakPips).toFixed(1));
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Server missing TRADINGVIEW_WEBHOOK_SECRET" }, { status: 500 });
  }

  let body: Incoming;
  try {
    body = (await req.json()) as Incoming;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const suppliedSecret = body.secret ?? req.headers.get("x-webhook-secret") ?? "";
  if (suppliedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
  }

  const pair = String(body.pair ?? body.symbol ?? "XAUUSD").trim().toUpperCase();
  const event = (normalized(body.event) ?? "signal") as "signal" | "price_update" | "signal_closed";
  const mode = (normalized(body.mode) ?? normalized(body.strategy) ?? "scalping") as "scalping" | "intraday";
  const type = (normalized(body.type) ?? normalized(body.side) ?? "buy") as "buy" | "sell";
  const entryTarget = asNumber(body.entry_target ?? body.entry);
  const livePrice = asNumber(body.live_price ?? body.price);
  const sl = asNumber(body.sl ?? body.stop_loss);
  const tp1 = asNumber(body.tp1);
  const tp2 = asNumber(body.tp2);
  const tp3 = asNumber(body.tp3);
  const status = body.status ?? "active";

  if (!["scalping", "intraday"].includes(mode)) {
    return NextResponse.json(
      { error: "mode/strategy must be scalping or intraday", received_mode: body.mode ?? body.strategy ?? null },
      { status: 400 },
    );
  }

  if (!["signal", "price_update", "signal_closed"].includes(event)) {
    return NextResponse.json(
      { error: "event must be signal, price_update or signal_closed", received_event: body.event ?? null },
      { status: 400 },
    );
  }

  if (event === "signal" && !["buy", "sell"].includes(type)) {
    return NextResponse.json(
      { error: "type/side must be buy or sell", received_type: body.type ?? body.side ?? null },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Server missing Supabase admin env vars" }, { status: 500 });
  }
  const brandId = resolveBrandId(req);
  if (!brandId) {
    return NextResponse.json({ error: "Server missing BRAND_ID / NEXT_PUBLIC_BRAND_ID" }, { status: 500 });
  }

  if (event === "price_update") {
    if (livePrice === null) {
      return NextResponse.json({ error: "live_price (or price) is required for price_update" }, { status: 400 });
    }

    const { data: current, error: currentError } = await admin
      .from("signals")
      .select("id, mode, type:action, entry_target:entry, tp1:take_profit_1, tp2:take_profit_2, tp3:take_profit_3, sl:stop_loss, max_floating_pips")
      .eq("brand_id", brandId)
      .eq("pair", pair)
      .eq("mode", mode)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (currentError) {
      return NextResponse.json({ error: currentError.message }, { status: 500 });
    }

    if (!current) {
      return NextResponse.json({ ok: false, reason: "no_active_signal_found", pair, mode }, { status: 404 });
    }

    const points = current.type === "buy" ? livePrice - Number(current.entry_target) : Number(current.entry_target) - livePrice;
    const currentPips = points * GOLD_PIPS_MULTIPLIER;
    const maxFloatingPips = Math.max(Number(current.max_floating_pips ?? 0), currentPips);

    const hitOutcome = inferHitOutcome({
      type: current.type,
      livePrice,
      sl: Number(current.sl),
      tp1: Number(current.tp1),
      tp2: Number(current.tp2),
      tp3: current.tp3 === null ? null : Number(current.tp3),
    });

    if (hitOutcome) {
      const realizedPips = currentPips;
      const peakPips = Math.max(maxFloatingPips, realizedPips);

      const { error: closeError } = await admin
        .from("signals")
        .update({
          live_price: livePrice,
          max_floating_pips: peakPips,
          status: "closed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id);
      if (closeError) return NextResponse.json({ error: closeError.message }, { status: 500 });

      const classifiedOutcome = classifyCycleOutcome({
        type: current.type,
        entryTarget: Number(current.entry_target),
        closePrice: livePrice,
        sl: Number(current.sl),
        tp1: Number(current.tp1),
        tp2: Number(current.tp2),
        tp3: current.tp3 === null ? null : Number(current.tp3),
        peakPips,
      });
      const historyPips = computeStoredNetPips({
        outcome: classifiedOutcome,
        realizedPips,
        peakPips,
      });

      const { data: logData, error: logError } = await admin
        .from("performance_logs")
        .insert({
          brand_id: brandId,
          signal_id: current.id,
          pair,
          mode: current.mode,
          action: current.type,
          outcome: classifiedOutcome,
          points: historyPips,
          price: livePrice,
          net_pips: historyPips,
          peak_pips: peakPips,
        })
        .select("id")
        .single();
      if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

      await sendTelegramTradingAlert([
        "*SHINOBI INDI Closed*",
        `*Mode:* ${current.mode.toUpperCase()}`,
        `*Pair:* ${pair}`,
        `*Type:* ${current.type.toUpperCase()}`,
        `*Outcome:* ${classifiedOutcome.toUpperCase()}`,
        `*Net Pips:* ${historyPips.toFixed(1)}`,
        `*Peak Pips:* ${peakPips.toFixed(1)}`,
      ]);

      return NextResponse.json({
        ok: true,
        event,
        auto_closed: true,
        signal_id: current.id,
        performance_log_id: logData.id,
        outcome: classifiedOutcome,
        realized_pips: realizedPips,
        peak_pips: peakPips,
        stored_history_pips: historyPips,
      });
    }

    const { error: updateError } = await admin
      .from("signals")
      .update({ live_price: livePrice, max_floating_pips: maxFloatingPips, updated_at: new Date().toISOString() })
      .eq("id", current.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, event, signal_id: current.id, live_price: livePrice, pair, mode });
  }

  if (event === "signal_closed") {
    const closePrice = asNumber(body.close_price ?? body.live_price ?? body.price);
    const outcomeRaw = normalized(body.outcome);
    if (outcomeRaw !== null && !["tp1", "tp2", "tp3", "be", "sl"].includes(outcomeRaw)) {
      return NextResponse.json({ error: "outcome must be tp1, tp2, tp3, be or sl" }, { status: 400 });
    }

    if (closePrice === null) {
      return NextResponse.json({ error: "close_price (or live_price/price) is required for signal_closed" }, { status: 400 });
    }

    const { data: current, error: currentError } = await admin
      .from("signals")
      .select("id, type:action, entry_target:entry, max_floating_pips, sl:stop_loss, tp1:take_profit_1, tp2:take_profit_2, tp3:take_profit_3")
      .eq("brand_id", brandId)
      .eq("pair", pair)
      .eq("mode", mode)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (!current) return NextResponse.json({ ok: false, reason: "no_active_signal_found", pair, mode }, { status: 404 });

    const points = current.type === "buy" ? closePrice - Number(current.entry_target) : Number(current.entry_target) - closePrice;
    const realizedPips = points * GOLD_PIPS_MULTIPLIER;
    const peakPips = Math.max(Number(current.max_floating_pips ?? 0), realizedPips);
    const classifiedOutcome = outcomeRaw
      ? (outcomeRaw as "tp1" | "tp2" | "tp3" | "be" | "sl")
      : classifyCycleOutcome({
        type: current.type,
        entryTarget: Number(current.entry_target),
        closePrice,
        sl: Number(current.sl),
        tp1: Number(current.tp1),
        tp2: Number(current.tp2),
        tp3: current.tp3 === null ? null : Number(current.tp3),
        peakPips,
      });
    const historyPips = computeStoredNetPips({
      outcome: classifiedOutcome,
      realizedPips,
      peakPips,
    });

    const { error: closeError } = await admin
      .from("signals")
      .update({ live_price: closePrice, status: "closed", max_floating_pips: peakPips, updated_at: new Date().toISOString() })
      .eq("id", current.id);
    if (closeError) return NextResponse.json({ error: closeError.message }, { status: 500 });

    const { data: logData, error: logError } = await admin
      .from("performance_logs")
      .insert({
        brand_id: brandId,
        signal_id: current.id,
        pair,
        mode,
        action: current.type,
        outcome: classifiedOutcome,
        points: historyPips,
        price: closePrice,
        net_pips: historyPips,
        peak_pips: peakPips,
      })
      .select("id")
      .single();
    if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

    await sendTelegramTradingAlert([
      "*SHINOBI INDI Closed*",
      `*Mode:* ${mode.toUpperCase()}`,
      `*Pair:* ${pair}`,
      `*Type:* ${current.type.toUpperCase()}`,
      `*Outcome:* ${classifiedOutcome.toUpperCase()}`,
      `*Net Pips:* ${historyPips.toFixed(1)}`,
      `*Peak Pips:* ${peakPips.toFixed(1)}`,
    ]);

    return NextResponse.json({
      ok: true,
      event,
      signal_id: current.id,
      performance_log_id: logData.id,
      realized_pips: realizedPips,
      peak_pips: peakPips,
      stored_history_pips: historyPips,
    });
  }

  if (entryTarget === null || livePrice === null || sl === null || tp1 === null || tp2 === null) {
    return NextResponse.json(
      { error: "entry_target (or entry), live_price (or price), sl (or stop_loss), tp1, tp2 are required numbers" },
      { status: 400 },
    );
  }

  if (event === "signal") {
    const cooldownFromIso = new Date(Date.now() - Math.max(10, SIGNAL_DUPLICATE_COOLDOWN_SECONDS) * 1000).toISOString();
    const { data: maybeDup, error: dupError } = await admin
      .from("signals")
      .select("id, entry_target:entry, created_at, status")
      .eq("brand_id", brandId)
      .eq("pair", pair)
      .eq("mode", mode)
      .eq("action", type)
      .eq("status", "active")
      .gte("created_at", cooldownFromIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dupError) {
      return NextResponse.json({ error: dupError.message }, { status: 500 });
    }

    if (maybeDup && Math.abs(Number(maybeDup.entry_target) - entryTarget) < 0.05) {
      return NextResponse.json({
        ok: true,
        duplicate_ignored: true,
        reason: "cooldown_active",
        signal_id: maybeDup.id,
        cooldown_seconds: Math.max(10, SIGNAL_DUPLICATE_COOLDOWN_SECONDS),
      });
    }
  }

  // On new signal event, archive previous active signal (same pair + mode) into performance history
  // so history remains continuous even when no explicit signal_closed/TP/SL event is sent.
  if (event === "signal") {
    const { data: previous } = await admin
      .from("signals")
      .select("id, type:action, entry_target:entry, live_price, max_floating_pips, created_at, sl:stop_loss, tp1:take_profit_1, tp2:take_profit_2, tp3:take_profit_3")
      .eq("brand_id", brandId)
      .eq("pair", pair)
      .eq("mode", mode)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (previous) {
      const closePrice = Number(previous.live_price);
      const points =
        previous.type === "buy"
          ? closePrice - Number(previous.entry_target)
          : Number(previous.entry_target) - closePrice;
      const realizedPips = points * GOLD_PIPS_MULTIPLIER;
      const peakPips = Math.max(Number(previous.max_floating_pips ?? 0), realizedPips);
      const outcome = classifyCycleOutcome({
        type: previous.type,
        entryTarget: Number(previous.entry_target),
        closePrice,
        sl: Number(previous.sl),
        tp1: Number(previous.tp1),
        tp2: Number(previous.tp2),
        tp3: previous.tp3 === null ? null : Number(previous.tp3),
        peakPips,
      });

      await admin
        .from("signals")
        .update({ status: "closed", updated_at: new Date().toISOString() })
        .eq("id", previous.id);

      const historyPips = computeStoredNetPips({
        outcome,
        realizedPips,
        peakPips,
      });

      await admin.from("performance_logs").insert({
        brand_id: brandId,
        signal_id: previous.id,
        pair,
        mode,
        action: previous.type,
        outcome,
        points: historyPips,
        price: closePrice,
        net_pips: historyPips,
        peak_pips: peakPips,
      });
    }
  }

  const immediateHit = event === "signal"
    ? inferHitOutcome({
      type,
      livePrice,
      sl,
      tp1,
      tp2,
      tp3,
    })
    : null;

  const immediateOutcome = immediateHit
    ? classifyCycleOutcome({
      type,
      entryTarget,
      closePrice: livePrice,
      sl,
      tp1,
      tp2,
      tp3,
      peakPips: Math.max(0, (type === "buy" ? livePrice - entryTarget : entryTarget - livePrice) * GOLD_PIPS_MULTIPLIER),
    })
    : null;

  const finalStatus = immediateHit ? "closed" : status;

  const { data, error } = await admin
    .from("signals")
    .insert({
      brand_id: brandId,
      pair,
      mode,
      action: type,
      entry: entryTarget,
      live_price: livePrice,
      stop_loss: sl,
      take_profit_1: tp1,
      take_profit_2: tp2,
      take_profit_3: tp3,
      max_floating_pips: 0,
      status: finalStatus,
      updated_at: new Date().toISOString(),
    })
    .select("id, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await sendTelegramTradingAlert([
    "*New SHINOBI INDI*",
    `*Mode:* ${mode.toUpperCase()}`,
    `*Pair:* ${pair}`,
    `*Type:* ${type.toUpperCase()}`,
    `*Entry:* ${entryTarget.toFixed(2)}`,
    `*Live:* ${livePrice.toFixed(2)}`,
    `*SL:* ${sl.toFixed(2)}`,
    `*TP1:* ${tp1.toFixed(2)}`,
    `*TP2:* ${tp2.toFixed(2)}`,
    `*TP3:* ${tp3 === null ? "-" : tp3.toFixed(2)}`,
  ]);

  if (event === "signal" && immediateOutcome) {
    const points = type === "buy" ? livePrice - entryTarget : entryTarget - livePrice;
    const realizedPips = points * GOLD_PIPS_MULTIPLIER;
    const peakPips = Math.max(0, realizedPips);
    const historyPips = computeStoredNetPips({
      outcome: immediateOutcome,
      realizedPips,
      peakPips,
    });

    const { data: logData, error: logError } = await admin
      .from("performance_logs")
      .insert({
        brand_id: brandId,
        signal_id: data.id,
        pair,
        mode,
        action: type,
        outcome: immediateOutcome,
        points: historyPips,
        price: livePrice,
        net_pips: historyPips,
        peak_pips: peakPips,
      })
      .select("id")
      .single();

    if (logError) {
      return NextResponse.json({ error: logError.message }, { status: 500 });
    }

    await sendTelegramTradingAlert([
      "*SHINOBI INDI Closed*",
      `*Mode:* ${mode.toUpperCase()}`,
      `*Pair:* ${pair}`,
      `*Type:* ${type.toUpperCase()}`,
      `*Outcome:* ${immediateOutcome.toUpperCase()}`,
      `*Net Pips:* ${historyPips.toFixed(1)}`,
      `*Peak Pips:* ${peakPips.toFixed(1)}`,
    ]);

    return NextResponse.json({
      ok: true,
      signal_id: data.id,
      created_at: data.created_at,
      auto_closed: true,
      performance_log_id: logData.id,
      outcome: immediateOutcome,
    });
  }

  return NextResponse.json({ ok: true, signal_id: data.id, created_at: data.created_at });
}


