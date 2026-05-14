"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AlertTriangle, BarChart3, CalendarClock, Clipboard, Eye, EyeOff, Moon, Package, ShieldCheck, Signal, Sun, Timer, User } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { resolveBrandId } from "@/lib/brand-id";
import type { PerformanceLog, Signal as TradingSignal, SignalMode } from "@/lib/types";

type Tab = "signal" | "performance";
type RangePreset = "day" | "week" | "month" | "custom";
type DesignVariant = "tactical" | "executive";
type LiveAlertKind = "signal" | "tp" | "sl";

type LiveAlert = {
  id: string;
  kind: LiveAlertKind;
  title: string;
  message: string;
  createdAt: number;
};

const SESSION_MINUTES = 120;
const SCALPING_INTERVAL_SECONDS = 30 * 60;
const INTRADAY_INTERVAL_SECONDS = 4 * 60 * 60;
const GOLD_PIPS_MULTIPLIER = 10;
const PERFORMANCE_DEFAULT_PAGE_SIZE = 10;
const ACCESS_KEY_STORAGE_KEY = "SHINOBI-access-key";

function fmt(value: number) {
  return value.toFixed(2);
}

function pipGain(signal: TradingSignal) {
  const points = signal.type === "buy"
    ? signal.live_price - signal.entry_target
    : signal.entry_target - signal.live_price;
  return points * GOLD_PIPS_MULTIPLIER;
}

function readNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeSignal(row: Record<string, unknown>): TradingSignal {
  const entry = readNumber(row.entry_target ?? row.entry);
  return {
    ...(row as Partial<TradingSignal>),
    id: String(row.id ?? `signal-${Date.now()}`),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    mode: row.mode === "intraday" ? "intraday" : "scalping",
    type: row.type === "sell" || row.action === "sell" ? "sell" : "buy",
    pair: String(row.pair ?? "XAUUSD"),
    entry_target: entry,
    live_price: readNumber(row.live_price, entry),
    sl: readNumber(row.sl ?? row.stop_loss),
    tp1: readNumber(row.tp1 ?? row.take_profit_1),
    tp2: readNumber(row.tp2 ?? row.take_profit_2),
    tp3: row.tp3 === null || row.take_profit_3 === null ? null : readNumber(row.tp3 ?? row.take_profit_3),
    max_floating_pips: row.max_floating_pips === null || row.max_floating_pips === undefined ? null : readNumber(row.max_floating_pips),
    status: row.status === "active" ? "active" : "closed",
  };
}

function normalizePerformanceLog(row: Record<string, unknown>): PerformanceLog {
  const peak = row.peak_pips ?? row.points ?? null;
  return {
    ...(row as Partial<PerformanceLog>),
    id: String(row.id ?? `performance-${Date.now()}`),
    created_at: String(row.created_at ?? new Date().toISOString()),
    mode: row.mode === "intraday" ? "intraday" : "scalping",
    type: row.type === "sell" || row.action === "sell" ? "sell" : "buy",
    outcome: row.outcome === "tp1" || row.outcome === "tp2" || row.outcome === "tp3" || row.outcome === "sl" || row.outcome === "be" ? row.outcome : "be",
    net_pips: readNumber(row.net_pips ?? row.points),
    peak_pips: peak === null || peak === undefined ? null : readNumber(peak),
  };
}

function performanceMinuteKey(item: PerformanceLog) {
  const d = new Date(item.created_at);
  const minute = Number.isNaN(d.getTime()) ? item.created_at.slice(0, 16) : d.toISOString().slice(0, 16);
  return `${minute}|${item.mode}|${item.type}|${item.outcome}`;
}

function dedupePerformanceItems(items: PerformanceLog[]) {
  const seen = new Set<string>();
  const out: PerformanceLog[] = [];
  for (const item of items) {
    const key = performanceMinuteKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = seconds % 60;
  if (hh > 0) return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

async function getFingerprint(): Promise<string> {
  const raw = [navigator.userAgent, navigator.language, screen.width, screen.height, Intl.DateTimeFormat().resolvedOptions().timeZone].join("|");
  const encoded = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function Home() {
  const supabase = getSupabaseClient();
  const brandId = useMemo(() => resolveBrandId(), []);
  const [authorized, setAuthorized] = useState(false);
  const [accessKey, setAccessKey] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [showAccessKey, setShowAccessKey] = useState(false);

  const [tab, setTab] = useState<Tab>("signal");
  const [mode, setMode] = useState<SignalMode>("scalping");
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [logs, setLogs] = useState<PerformanceLog[]>([]);
  const [riskAmount, setRiskAmount] = useState("100");
  const [sessionSeconds, setSessionSeconds] = useState(SESSION_MINUTES * 60);
  const [nowMs, setNowMs] = useState(Date.now());
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [activeAccessKeyId, setActiveAccessKeyId] = useState<string | null>(null);
  const [activeSessionToken, setActiveSessionToken] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string>("-");
  const [accountPackage, setAccountPackage] = useState<string>("-");
  const [subscriptionExpiry, setSubscriptionExpiry] = useState<string | null>(null);
  const [rangePreset, setRangePreset] = useState<RangePreset>("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [designVariant, setDesignVariant] = useState<DesignVariant>("executive");
  const [showLoginDisclaimer, setShowLoginDisclaimer] = useState(false);
  const [performancePageSize, setPerformancePageSize] = useState<number | "all">(PERFORMANCE_DEFAULT_PAGE_SIZE);
  const [performancePage, setPerformancePage] = useState(1);
  const [liveAlerts, setLiveAlerts] = useState<LiveAlert[]>([]);
  const [activeSignalPopup, setActiveSignalPopup] = useState<LiveAlert | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const notifiedEventKeysRef = useRef<Set<string>>(new Set());
  const initializedAlertSnapshotRef = useRef(false);
  const lastSeenSignalIdRef = useRef<string | null>(null);
  const lastSeenPerfIdRef = useRef<string | null>(null);

  const pushLiveAlert = useCallback((alert: LiveAlert) => {
    setLiveAlerts((prev) => [alert, ...prev].slice(0, 20));
    setActiveSignalPopup(alert);
    if (typeof window !== "undefined" && notificationPermission === "granted") {
      new Notification(alert.title, { body: alert.message });
    }
  }, [notificationPermission]);

  const fetchDashboardData = useCallback(async (sb: NonNullable<ReturnType<typeof getSupabaseClient>>) => {
    const [serverSignalRes, serverLogRes] = await Promise.all([
      fetch("/api/signals?pair=XAUUSD&limit=50", { cache: "no-store" }),
      fetch("/api/performance-logs?limit=300", { cache: "no-store" }),
    ]);

    try {
      if (serverSignalRes.ok) {
        const json = (await serverSignalRes.json()) as { data?: TradingSignal[] };
        if (Array.isArray(json.data)) {
          setSignals(json.data.map((row) => normalizeSignal(row as unknown as Record<string, unknown>)));
        }
      }
    } catch {
      // keep existing signals when server fetch fails
    }

    try {
      if (serverLogRes.ok) {
        const json = (await serverLogRes.json()) as { data?: PerformanceLog[] };
          if (Array.isArray(json.data)) {
            const normalized = json.data.map((row) => normalizePerformanceLog(row as unknown as Record<string, unknown>));
            setLogs(dedupePerformanceItems(normalized));
          }
        }
      } catch {
        // keep existing logs when server fetch fails
    }
    setLastSync(new Date().toLocaleTimeString());
  }, [brandId]);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("shinobi-indi-theme") : null;
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("shinobi-indi-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedAccessKey = window.localStorage.getItem(ACCESS_KEY_STORAGE_KEY);
    if (savedAccessKey) setAccessKey(savedAccessKey);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const trimmed = accessKey.trim();
    if (!trimmed) {
      window.localStorage.removeItem(ACCESS_KEY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ACCESS_KEY_STORAGE_KEY, trimmed);
  }, [accessKey]);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("shinobi-indi-design") : null;
    if (saved === "tactical" || saved === "executive") setDesignVariant(saved);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("shinobi-indi-design", designVariant);
  }, [designVariant]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (!authorized) {
      initializedAlertSnapshotRef.current = false;
      lastSeenSignalIdRef.current = null;
      lastSeenPerfIdRef.current = null;
      return;
    }
    if (!signals.length && !logs.length) return;

    if (!initializedAlertSnapshotRef.current) {
      lastSeenSignalIdRef.current = signals[0]?.id ?? null;
      lastSeenPerfIdRef.current = logs[0]?.id ?? null;
      initializedAlertSnapshotRef.current = true;
      return;
    }

    const latestSignal = signals[0];
    if (latestSignal && latestSignal.id !== lastSeenSignalIdRef.current && latestSignal.status === "active") {
      lastSeenSignalIdRef.current = latestSignal.id;
      const eventKey = `signal:${latestSignal.id}`;
      if (!notifiedEventKeysRef.current.has(eventKey)) {
        notifiedEventKeysRef.current.add(eventKey);
        pushLiveAlert({
          id: eventKey,
          kind: "signal",
          title: `New ${latestSignal.mode.toUpperCase()} Signal`,
          message: `${latestSignal.type.toUpperCase()} XAUUSD @ ${fmt(latestSignal.entry_target)}`,
          createdAt: Date.now(),
        });
      }
    } else if (latestSignal) {
      lastSeenSignalIdRef.current = latestSignal.id;
    }

    const latestPerf = logs[0];
    if (latestPerf && latestPerf.id !== lastSeenPerfIdRef.current) {
      lastSeenPerfIdRef.current = latestPerf.id;
      const isTp = latestPerf.outcome === "tp1" || latestPerf.outcome === "tp2" || latestPerf.outcome === "tp3";
      const isSl = latestPerf.outcome === "sl";
      if (isTp || isSl) {
        const upperOutcome = latestPerf.outcome.toUpperCase();
        const eventKey = `performance:${latestPerf.id}:${latestPerf.outcome}`;
        if (!notifiedEventKeysRef.current.has(eventKey)) {
          notifiedEventKeysRef.current.add(eventKey);
          pushLiveAlert({
            id: eventKey,
            kind: isTp ? "tp" : "sl",
            title: isTp ? `${upperOutcome} Hit` : "Stop Loss Hit",
            message: `${latestPerf.mode.toUpperCase()} ${latestPerf.type.toUpperCase()} | ${latestPerf.net_pips.toFixed(1)} pips`,
            createdAt: Date.now(),
          });
        }
      }
    } else if (latestPerf) {
      lastSeenPerfIdRef.current = latestPerf.id;
    }
  }, [authorized, signals, logs, pushLiveAlert]);

  useEffect(() => {
    if (!authorized || !supabase) return;
    const t = setInterval(() => setSessionSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [authorized, supabase]);

  useEffect(() => {
    if (!authorized) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [authorized]);

  useEffect(() => {
    if (!authorized || !supabase) return;
    const sb = supabase;

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission().then((permission) => setNotificationPermission(permission));
    }

    const load = async () => {
      await fetchDashboardData(sb);
    };

    void load();

    const handleSignalEvent = (payload: { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Record<string, unknown> }) => {
      if (payload.eventType === "DELETE") return;
      if (payload.new.brand_id && String(payload.new.brand_id) !== brandId) return;
      const next = normalizeSignal(payload.new);
      setSignals((prev) => [next, ...prev.filter((s) => s.id !== next.id)].slice(0, 50));

      if (next.status === "active") {
        const eventKey = `signal:${next.id}`;
        if (!notifiedEventKeysRef.current.has(eventKey)) {
          notifiedEventKeysRef.current.add(eventKey);
          pushLiveAlert({
            id: eventKey,
            kind: "signal",
            title: `New ${next.mode.toUpperCase()} Signal`,
            message: `${next.type.toUpperCase()} XAUUSD @ ${fmt(next.entry_target)}`,
            createdAt: Date.now(),
          });
        }
      }
    };

    const handlePerformanceEvent = (payload: { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Record<string, unknown> }) => {
      if (payload.eventType === "DELETE") return;
      if (payload.new.brand_id && String(payload.new.brand_id) !== brandId) return;
      const next = normalizePerformanceLog(payload.new);
      setLogs((prev) => dedupePerformanceItems([next, ...prev.filter((s) => s.id !== next.id)]).slice(0, 200));

      const upperOutcome = next.outcome.toUpperCase();
      const isTp = next.outcome === "tp1" || next.outcome === "tp2" || next.outcome === "tp3";
      const isSl = next.outcome === "sl";
      if (isTp || isSl) {
        const eventKey = `performance:${next.id}:${next.outcome}`;
        if (!notifiedEventKeysRef.current.has(eventKey)) {
          notifiedEventKeysRef.current.add(eventKey);
          pushLiveAlert({
            id: eventKey,
            kind: isTp ? "tp" : "sl",
            title: isTp ? `${upperOutcome} Hit` : "Stop Loss Hit",
            message: `${next.mode.toUpperCase()} ${next.type.toUpperCase()} | ${next.net_pips.toFixed(1)} pips`,
            createdAt: Date.now(),
          });
        }
      }
    };

    const channel = sb
      .channel("shinobi-indi-stream")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "signals", filter: `brand_id=eq.${brandId}` }, (payload) =>
        handleSignalEvent(payload as unknown as { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Record<string, unknown> }),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "signals", filter: `brand_id=eq.${brandId}` }, (payload) =>
        handleSignalEvent(payload as unknown as { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Record<string, unknown> }),
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "performance_logs", filter: `brand_id=eq.${brandId}` }, (payload) =>
        handlePerformanceEvent(payload as unknown as { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Record<string, unknown> }),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "performance_logs", filter: `brand_id=eq.${brandId}` }, (payload) =>
        handlePerformanceEvent(payload as unknown as { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Record<string, unknown> }),
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [authorized, supabase, fetchDashboardData, pushLiveAlert, brandId]);

  useEffect(() => {
    if (!authorized || !supabase) return;
    const sb = supabase;
    const timer = setInterval(() => {
      void fetchDashboardData(sb);
    }, 15000);
    return () => clearInterval(timer);
  }, [authorized, supabase, fetchDashboardData]);

  useEffect(() => {
    if (!authorized || !activeAccessKeyId || !activeSessionToken) return;
    const timer = setInterval(async () => {
      const res = await fetch("/api/access/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKeyId: activeAccessKeyId, sessionToken: activeSessionToken }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string; data?: { expired_at: string | null } } | null;
      if (!res.ok) {
        setAuthorized(false);
        setAuthError(json?.error ?? "Access key revoked. Please contact admin.");
        setActiveAccessKeyId(null);
        setActiveSessionToken(null);
        setAccountName("-");
        setAccountPackage("-");
        setSubscriptionExpiry(null);
        setSessionSeconds(SESSION_MINUTES * 60);
        return;
      }
      if (json?.data) {
        setSubscriptionExpiry(json.data.expired_at ?? null);
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [authorized, activeAccessKeyId, activeSessionToken]);

  const activeSignals = useMemo(() => signals.filter((s) => s.mode === mode), [signals, mode]);
  const activeSignal = activeSignals.find((s) => s.status === "active") ?? activeSignals[0];
  const rangeStartMs = useMemo(() => {
    const now = new Date();
    if (rangePreset === "day") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return start.getTime();
    }
    if (rangePreset === "week") {
      const start = new Date(now);
      const jsDay = start.getDay(); // Sunday=0 ... Saturday=6
      const daysFromMonday = (jsDay + 6) % 7;
      start.setDate(start.getDate() - daysFromMonday);
      start.setHours(0, 0, 0, 0);
      return start.getTime();
    }
    if (rangePreset === "month") return now.getTime() - 30 * 24 * 60 * 60 * 1000;
    if (!customFrom) return 0;
    return new Date(`${customFrom}T00:00:00`).getTime();
  }, [rangePreset, customFrom]);

  const rangeEndMs = useMemo(() => {
    if (rangePreset !== "custom" || !customTo) return Infinity;
    return new Date(`${customTo}T23:59:59`).getTime();
  }, [rangePreset, customTo]);

  const filteredLogs = useMemo(
    () =>
      logs.filter((l) => {
        if (l.mode !== mode) return false;
        const t = new Date(l.created_at).getTime();
        return t >= rangeStartMs && t <= rangeEndMs;
      }),
    [logs, mode, rangeStartMs, rangeEndMs],
  );

  const totalPerformancePages = useMemo(() => {
    if (performancePageSize === "all") return 1;
    return Math.max(1, Math.ceil(filteredLogs.length / performancePageSize));
  }, [filteredLogs.length, performancePageSize]);

  const visibleLogs = useMemo(() => {
    if (performancePageSize === "all") return filteredLogs;
    const start = (performancePage - 1) * performancePageSize;
    return filteredLogs.slice(start, start + performancePageSize);
  }, [filteredLogs, performancePageSize, performancePage]);

  useEffect(() => {
    setPerformancePage(1);
  }, [mode, rangePreset, customFrom, customTo, performancePageSize]);

  useEffect(() => {
    if (performancePage > totalPerformancePages) {
      setPerformancePage(totalPerformancePages);
    }
  }, [performancePage, totalPerformancePages]);

  const stats = useMemo(() => {
    const total = filteredLogs.length;
    const wins = filteredLogs.filter((l) => l.outcome !== "sl").length;
    const totalPips = filteredLogs.reduce((acc, item) => acc + item.net_pips, 0);
    const totalTp = filteredLogs.filter((l) => l.outcome === "tp1" || l.outcome === "tp2" || l.outcome === "tp3").length;
    const totalBe = filteredLogs.filter((l) => l.outcome === "be").length;
    const totalSl = filteredLogs.filter((l) => l.outcome === "sl").length;
    const byTp = {
      tp1: filteredLogs.filter((l) => l.outcome === "tp1").length,
      tp2: filteredLogs.filter((l) => l.outcome === "tp2").length,
      tp3: filteredLogs.filter((l) => l.outcome === "tp3").length,
      be: filteredLogs.filter((l) => l.outcome === "be").length,
      sl: filteredLogs.filter((l) => l.outcome === "sl").length,
    };

    return {
      winRate: total ? (wins / total) * 100 : 0,
      totalPips,
      signalCount: total,
      totalTp,
      totalBe,
      totalSl,
      byTp,
    };
  }, [filteredLogs]);

  const lotSize = useMemo(() => {
    if (!activeSignal) return 0;
    const risk = Number(riskAmount);
    if (!risk || risk <= 0) return 0;
    const slPips = Math.abs(activeSignal.entry_target - activeSignal.sl) * GOLD_PIPS_MULTIPLIER;
    if (!slPips) return 0;
    return risk / (slPips * 10);
  }, [riskAmount, activeSignal]);

  const nextSignalCountdown = useMemo(() => {
    const interval = mode === "scalping" ? SCALPING_INTERVAL_SECONDS : INTRADAY_INTERVAL_SECONDS;
    const nowSec = Math.floor(nowMs / 1000);
    const remaining = interval - (nowSec % interval);
    return formatClock(remaining === interval ? 0 : remaining);
  }, [mode, nowMs]);

  const login = async () => {
    if (!supabase) {
      setAuthError("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY first.");
      return;
    }

    setLoadingAuth(true);
    setAuthError(null);

    try {
      const res = await fetch("/api/access/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: accessKey.trim(), fingerprint: await getFingerprint() }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        data?: { id: string; label: string | null; expired_at: string | null; session_token: string };
      } | null;

      if (!res.ok || !json?.data) {
        setAuthError(json?.error ?? "Authorization denied: invalid key.");
        return;
      }

      const row = json.data;
      setActiveAccessKeyId(row.id);
      setActiveSessionToken(row.session_token);
      const parsedName = row.label?.split("|")[0]?.trim();
      const parsedPackageRaw = row.label?.split("|")[1]?.trim() ?? "";
      const daysMatch = parsedPackageRaw.match(/(\d+)\s*D/i);
      const parsedPackage = daysMatch ? `${daysMatch[1]} Days` : parsedPackageRaw || "-";
      setAccountName(parsedName && parsedName.length > 0 ? parsedName : "Authorized User");
      setAccountPackage(parsedPackage);
      setSubscriptionExpiry(row.expired_at ?? null);
      setAuthorized(true);
      setShowLoginDisclaimer(true);
    } finally {
      setLoadingAuth(false);
    }
  };

  const copyLot = async () => {
    await navigator.clipboard.writeText(lotSize.toFixed(2));
  };

  const logout = () => {
    setAuthorized(false);
    setAccessKey("");
    setAuthError(null);
    setLoadingAuth(false);
    setSessionSeconds(SESSION_MINUTES * 60);
    setActiveAccessKeyId(null);
    setActiveSessionToken(null);
    setAccountName("-");
    setAccountPackage("-");
    setSubscriptionExpiry(null);
    setShowLoginDisclaimer(false);
    setActiveSignalPopup(null);
  };

  const clearSavedAccessKey = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ACCESS_KEY_STORAGE_KEY);
    }
    setAccessKey("");
  };

  const refreshNow = async () => {
    if (!supabase || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await fetchDashboardData(supabase);
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!authorized) {
    const loginDark = theme === "dark";
    return (
      <main className={`grid min-h-screen place-items-center px-4 ${loginDark ? "" : "light-theme bg-[#e2e8f0] text-[#0f172a]"} ${designVariant === "executive" ? "design-executive" : ""}`}>
        <section className={`scanlines relative w-full max-w-md rounded-2xl p-6 ${loginDark ? "border border-[#d4af37]/35 bg-[#0c0a12]/88 shadow-[0_0_46px_rgba(212,175,55,0.15)]" : "border border-[#0f172a]/20 bg-[#f8fafc] shadow-[0_10px_30px_rgba(15,23,42,0.14)]"}`}>
          <div className="mb-4 flex justify-center">
            <Image
              src="/shinobi-logo.png"
              alt="SHINOBI INDI Signal"
              width={396}
              height={396}
              className="h-72 w-72 object-contain drop-shadow-[0_0_18px_rgba(212,175,55,0.25)]"
              priority
            />
          </div>
          <div className="mb-3 flex justify-end gap-2">
            <button
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              className={`inline-flex items-center gap-1 rounded border px-3 py-1.5 text-[10px] font-bold ${
                designVariant === "executive"
                  ? "exec-head-btn"
                  : "border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/20"
              }`}
            >
              {loginDark ? <Sun size={12} /> : <Moon size={12} />}
              {loginDark ? "Light" : "Dark"}
            </button>
          </div>
          <h1
            className={`font-luxury-serif mb-2 text-3xl font-semibold leading-[1.02] sm:text-4xl ${loginDark ? "text-[#f8f3df]" : "text-[#0f172a]"}`}
            style={{ fontFamily: "var(--font-cinzel), Georgia, serif" }}
          >
            SHINOBI INDI
          </h1>
          <label className="mb-2 block text-xs uppercase tracking-[0.25em] text-[#d4af37]">Authorization Key</label>
          <div className="relative">
            <input
              type={showAccessKey ? "text" : "password"}
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              className={`w-full rounded border px-3 py-2 pr-11 outline-none ring-emerald-400/40 focus:ring ${loginDark ? "border-emerald-400/30 bg-black text-emerald-200" : "border-emerald-700/60 bg-white text-[#0f172a]"}`}
              placeholder="ENTER_KEY"
            />
            <button
              type="button"
              onClick={() => setShowAccessKey((prev) => !prev)}
              className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 ${loginDark ? "text-[#d4af37] hover:bg-[#d4af37]/10" : "text-slate-600 hover:bg-slate-100"}`}
              aria-label={showAccessKey ? "Hide access key" : "Show access key"}
              title={showAccessKey ? "Hide" : "Show"}
            >
              {showAccessKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {authError && <p className="mt-3 flex items-center gap-2 text-sm text-red-400"><AlertTriangle size={14} />{authError}</p>}
          {!supabase && <p className="mt-3 text-xs text-red-400">Supabase environment variables are missing.</p>}
          <button
            onClick={login}
            disabled={loadingAuth || !accessKey.trim()}
            className={`mt-5 w-full rounded border py-2 transition disabled:opacity-50 ${
              loginDark ? "border-[#d4af37]/45 bg-[#2c1b35] text-[#f6dc8c] hover:bg-[#3a2246]" : "border-[#1e3a8a]/35 bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
            }`}
          >
            {loadingAuth ? "VALIDATING..." : "AUTHORIZE"}
          </button>
          <button
            onClick={clearSavedAccessKey}
            type="button"
            className={`mt-2 w-full rounded border py-2 text-xs ${
              loginDark
                ? "border-red-400/40 text-red-300 hover:bg-red-500/10"
                : "border-red-500/40 text-red-700 hover:bg-red-50"
            }`}
          >
            CLEAR SAVED KEY
          </button>
        </section>
      </main>
    );
  }

  const isDark = theme === "dark";
  const isExecutive = designVariant === "executive";

  return (
    <main className={`min-h-screen px-3 py-4 sm:px-6 ${isDark ? "" : "light-theme bg-[#e2e8f0] text-[#0f172a]"} ${designVariant === "executive" ? "design-executive" : ""}`}>
      <div className={`scanlines mx-auto max-w-6xl rounded-2xl p-3 sm:p-6 ${isDark ? "border border-emerald-500/40 bg-black/80 shadow-[0_0_60px_rgba(16,185,129,0.16)]" : "border border-[#0f172a]/20 bg-[#f8fafc] shadow-[0_10px_30px_rgba(15,23,42,0.14)]"}`}>
        {isExecutive && (
          <header className="mb-5 border-b border-emerald-400/20 pb-4 text-[11px] uppercase tracking-[0.16em] text-emerald-300 sm:text-xs sm:tracking-[0.2em]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="exec-top-brand leading-none text-blue-400">SHINOBI INDI</p>
                <p className="exec-top-sub mt-1">PROFITABLE DISCIPLINE STARTS HERE</p>
              </div>
              <div className="exec-action-group flex flex-wrap items-center gap-2">
                <div className="mr-2 text-right">
                  <p className="text-[9px] tracking-[0.14em] text-emerald-300/65">ACCESS STATUS</p>
                  <p className="text-xs normal-case text-emerald-300">Authorized</p>
                </div>
                <button onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))} className="exec-head-btn inline-flex items-center justify-center gap-1 rounded border border-emerald-400/40 px-2 py-1 text-[10px] hover:bg-emerald-500/20">
                  {isDark ? <Sun size={12} /> : <Moon size={12} />}
                  {isDark ? "Light" : "Dark"}
                </button>
                <button onClick={refreshNow} disabled={isRefreshing} className="inline-flex items-center justify-center gap-1 rounded border border-emerald-400/40 px-2 py-1 text-[10px] hover:bg-emerald-500/20 disabled:opacity-50">
                  {isRefreshing ? "Syncing..." : "Refresh"}
                </button>
                <button onClick={logout} className="inline-flex items-center justify-center gap-1 rounded border border-red-400/40 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/15">
                  Log out
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] tracking-[0.14em] text-emerald-300/80">
              <span className="inline-flex items-center gap-1"><ShieldCheck size={12} />System Secure</span>
              <span className="inline-flex items-center gap-1"><User size={12} />{accountName}</span>
              <span className="inline-flex items-center gap-1"><Package size={12} />{accountPackage}</span>
              <span className="inline-flex items-center gap-1"><CalendarClock size={12} />{formatDateTime(subscriptionExpiry)}</span>
              <span className="inline-flex items-center gap-1"><Signal size={12} />XAUUSD</span>
              <span className="inline-flex items-center gap-1"><Timer size={12} />{formatClock(sessionSeconds)}</span>
            </div>
          </header>
        )}
        {lastSync && <p className="exec-last-sync mb-3 text-[10px] uppercase tracking-[0.15em] text-emerald-300/65">Last Sync: {lastSync}</p>}

        <nav className={`mb-4 flex gap-2 ${isExecutive ? "exec-pill-group w-fit" : ""}`}>
          <button
            onClick={() => setTab("signal")}
            className={`rounded px-3 py-2 text-sm ${tab === "signal" ? "bg-emerald-500/20 text-emerald-300 pulse" : "border border-emerald-400/30 text-emerald-400/70"} ${isExecutive ? "px-5 py-2 text-xs font-bold tracking-wide" : ""} ${isExecutive && tab === "signal" ? "exec-primary" : ""} ${isExecutive && tab !== "signal" ? "exec-muted border-transparent bg-transparent" : ""}`}
          >
            SIGNAL
          </button>
          <button
            onClick={() => setTab("performance")}
            className={`rounded px-3 py-2 text-sm ${tab === "performance" ? "bg-emerald-500/20 text-emerald-300 pulse" : "border border-emerald-400/30 text-emerald-400/70"} ${isExecutive ? "px-5 py-2 text-xs font-bold tracking-wide" : ""} ${isExecutive && tab === "performance" ? "exec-primary" : ""} ${isExecutive && tab !== "performance" ? "exec-muted border-transparent bg-transparent" : ""}`}
          >
            PERFORMANCE
          </button>
        </nav>

        <div className={`mb-4 flex gap-2 ${isExecutive ? "items-center justify-between" : ""}`}>
          <div className={`flex gap-2 ${isExecutive ? "exec-pill-group" : ""}`}>
            <button onClick={() => setMode("scalping")} className={`rounded border px-3 py-1 text-xs ${mode === "scalping" ? "border-emerald-300 bg-emerald-500/20" : "border-emerald-400/30"} ${isExecutive ? "px-8 py-2.5 text-sm font-extrabold tracking-wide uppercase" : ""} ${isExecutive && mode === "scalping" ? "exec-primary" : ""} ${isExecutive && mode !== "scalping" ? "exec-muted border-transparent bg-transparent" : ""}`}>Scalping</button>
            <button onClick={() => setMode("intraday")} className={`rounded border px-3 py-1 text-xs ${mode === "intraday" ? "border-emerald-300 bg-emerald-500/20" : "border-emerald-400/30"} ${isExecutive ? "px-8 py-2.5 text-sm font-extrabold tracking-wide uppercase" : ""} ${isExecutive && mode === "intraday" ? "exec-primary" : ""} ${isExecutive && mode !== "intraday" ? "exec-muted border-transparent bg-transparent" : ""}`}>Intraday</button>
          </div>
          {isExecutive && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-center">
              <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-300/75">Next Signal</p>
              <p className="text-2xl font-semibold text-emerald-200">{nextSignalCountdown}</p>
            </div>
          )}
        </div>

        {tab === "signal" ? (
          isExecutive ? (
            <section className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
                <div className="exec-signal-panel rounded-2xl border border-emerald-500/30 p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-5xl font-bold tracking-tight text-emerald-200">XAUUSD</p>
                      <p className={`text-sm font-semibold tracking-[0.12em] ${activeSignal?.type === "buy" ? "text-emerald-300" : "text-red-400"}`}>
                        {activeSignal ? `${activeSignal.type.toUpperCase()} SETUP CONFIRMED` : "NO ACTIVE SETUP"}
                      </p>
                    </div>
                    <div className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-6 py-2 text-sm font-bold text-emerald-200">
                      EXECUTE {activeSignal?.type?.toUpperCase() ?? "SIGNAL"}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <Card title="Entry" value={activeSignal ? fmt(activeSignal.entry_target) : "-"} className="exec-card" copyValue={activeSignal ? fmt(activeSignal.entry_target) : undefined} />
                    <Card title="TP1" value={activeSignal ? fmt(activeSignal.tp1) : "-"} className="exec-card exec-card-tp" copyValue={activeSignal ? fmt(activeSignal.tp1) : undefined} />
                    <Card title="TP2" value={activeSignal ? fmt(activeSignal.tp2) : "-"} className="exec-card" copyValue={activeSignal ? fmt(activeSignal.tp2) : undefined} />
                    <Card title="TP3" value={activeSignal && activeSignal.tp3 !== null ? fmt(activeSignal.tp3) : "-"} className="exec-card" copyValue={activeSignal && activeSignal.tp3 !== null ? fmt(activeSignal.tp3) : undefined} />
                    <Card title="Stop Loss" value={activeSignal ? fmt(activeSignal.sl) : "-"} highlight={false} className="exec-card exec-card-sl" copyValue={activeSignal ? fmt(activeSignal.sl) : undefined} />
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <Card
                      title="Live Price"
                      value={activeSignal ? fmt(activeSignal.live_price) : "-"}
                      meta={activeSignal ? `Live Price Updated: ${new Date(activeSignal.updated_at ?? activeSignal.created_at).toLocaleTimeString()}` : "Live Price Updated: -"}
                      className="exec-card"
                    />
                    <Card
                      title="Pips Gain"
                      value={activeSignal ? `${pipGain(activeSignal).toFixed(1)} pips` : "-"}
                      meta={activeSignal ? `Pips Updated: ${new Date(activeSignal.updated_at ?? activeSignal.created_at).toLocaleTimeString()}` : "Pips Updated: -"}
                      className="exec-card"
                    />
                    <Card
                      title="Signal Direction"
                      value={activeSignal ? activeSignal.type.toUpperCase() : "-"}
                      highlight={activeSignal?.type !== "sell"}
                      className="exec-card"
                    />
                  </div>
                </div>

                <div className="exec-planner-panel rounded-2xl border border-emerald-500/30 p-5">
                  <p className="mb-3 text-4xl font-bold tracking-tight text-emerald-100">Tactical Planner</p>
                  <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-emerald-300/80">Risk Amount (USD)</label>
                  <input
                    value={riskAmount}
                    onChange={(e) => setRiskAmount(e.target.value)}
                    className={`mb-4 w-full rounded-xl border px-3 py-3 ${isDark ? "border-emerald-400/30 bg-black text-emerald-200" : "border-emerald-700/60 bg-white text-[#0f172a]"}`}
                  />
                  <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-5 text-center">
                    <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/80">Recommended Lot Size</p>
                    <p className="mt-1 text-4xl font-bold text-emerald-200">{lotSize.toFixed(2)}</p>
                  </div>
                  <button onClick={copyLot} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/50 px-3 py-3 text-sm font-semibold hover:bg-emerald-500/20">
                    <Clipboard size={14} />Copy Lot
                  </button>
                </div>
              </div>

            </section>
          ) : (
            <section className="space-y-4">
              <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm">
                <span className="uppercase tracking-[0.2em] text-emerald-300/75">Next Signal</span>
                <p className="mt-1 text-2xl text-emerald-300">{nextSignalCountdown}</p>
              </div>
              {activeSignal && (
                <div className="rounded border border-emerald-500/30 px-4 py-2 text-sm">
                  <span className="uppercase tracking-[0.2em] text-emerald-300/75">Signal Direction</span>
                  <p className={`mt-1 text-xl ${activeSignal.type === "buy" ? "text-emerald-300" : "text-red-400"}`}>
                    {activeSignal.type.toUpperCase()}
                  </p>
                </div>
              )}
              <div className="grid gap-2 sm:gap-3 sm:grid-cols-3">
                <Card title="Entry" value={activeSignal ? fmt(activeSignal.entry_target) : "-"} copyValue={activeSignal ? fmt(activeSignal.entry_target) : undefined} />
                <Card
                  title="Live Price"
                  value={activeSignal ? fmt(activeSignal.live_price) : "-"}
                  meta={activeSignal ? `Live Price Updated: ${new Date(activeSignal.updated_at ?? activeSignal.created_at).toLocaleTimeString()}` : "Live Price Updated: -"}
                />
                <Card
                  title="Pips Gain"
                  value={activeSignal ? `${pipGain(activeSignal).toFixed(1)} pips` : "-"}
                  meta={activeSignal ? `Pips Updated: ${new Date(activeSignal.updated_at ?? activeSignal.created_at).toLocaleTimeString()}` : "Pips Updated: -"}
                />
              </div>

              {activeSignal && (
                <div className="rounded border border-emerald-500/30 p-4">
                  <p className="mb-2 text-xs uppercase tracking-[0.2em] text-emerald-300">Trading Levels</p>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 sm:text-sm">
                    <Level label="TP1" value={activeSignal.tp1} positive copyable />
                    <Level label="TP2" value={activeSignal.tp2} positive copyable />
                    <Level label="TP3" value={activeSignal.tp3 ?? 0} positive muted={!activeSignal.tp3} copyable={Boolean(activeSignal.tp3)} />
                    <Level label="Stop Loss" value={activeSignal.sl} danger copyable />
                  </div>
                </div>
              )}

              <div className="rounded border border-emerald-500/30 p-3 sm:p-4">
                <p className="mb-3 text-xs uppercase tracking-[0.2em] text-emerald-300">Risk Planner</p>
                <div className="flex flex-col gap-2 sm:gap-3 sm:flex-row sm:items-end">
                  <div className="w-full sm:max-w-xs">
                    <label className="mb-1 block text-xs text-emerald-300/80">Risk Amount (USD)</label>
                    <input
                      value={riskAmount}
                      onChange={(e) => setRiskAmount(e.target.value)}
                      className={`w-full rounded border px-3 py-2 ${isDark ? "border-emerald-400/30 bg-black text-emerald-200" : "border-emerald-700/60 bg-white text-[#0f172a]"}`}
                    />
                  </div>
                  <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-2xl text-emerald-300 shadow-[0_0_25px_rgba(16,185,129,0.25)]">{lotSize.toFixed(2)} LOT</div>
                  <button onClick={copyLot} className="inline-flex items-center justify-center gap-2 rounded border border-emerald-300/50 px-3 py-2 text-sm hover:bg-emerald-500/20 sm:px-4"><Clipboard size={14} />Copy Lot</button>
                </div>
              </div>
            </section>
          )
        ) : (
          <section className="space-y-4">
            <div className="flex flex-wrap items-end gap-2 rounded border border-emerald-500/30 p-3">
              <button onClick={() => setRangePreset("day")} className={`rounded border px-3 py-1 text-xs ${rangePreset === "day" ? "border-emerald-300 bg-emerald-500/20" : "border-emerald-400/30"}`}>Day</button>
              <button onClick={() => setRangePreset("week")} className={`rounded border px-3 py-1 text-xs ${rangePreset === "week" ? "border-emerald-300 bg-emerald-500/20" : "border-emerald-400/30"}`}>Week</button>
              <button onClick={() => setRangePreset("month")} className={`rounded border px-3 py-1 text-xs ${rangePreset === "month" ? "border-emerald-300 bg-emerald-500/20" : "border-emerald-400/30"}`}>Month</button>
              <button onClick={() => setRangePreset("custom")} className={`rounded border px-3 py-1 text-xs ${rangePreset === "custom" ? "border-emerald-300 bg-emerald-500/20" : "border-emerald-400/30"}`}>Custom</button>
              {rangePreset === "custom" && (
                <>
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded border border-emerald-400/40 bg-black/20 px-2 py-1 text-xs" />
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded border border-emerald-400/40 bg-black/20 px-2 py-1 text-xs" />
                </>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <Card title="Win Rate %" value={`${stats.winRate.toFixed(1)}%`} />
              <Card title="Total Pips" value={stats.totalPips.toFixed(1)} />
              <Card title="Signal Count" value={String(stats.signalCount)} />
              <Card title="Total TP" value={String(stats.totalTp)} />
              <Card title="Total BE" value={String(stats.totalBe)} />
              <Card title="Total SL" value={String(stats.totalSl)} highlight={false} />
            </div>

            <div className="rounded border border-emerald-500/30 p-4">
              <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-emerald-300"><BarChart3 size={14} />Profit Loss Distribution</p>
              <div className="space-y-2 text-xs">
                <Dist label="TP1" count={stats.byTp.tp1} total={stats.signalCount} />
                <Dist label="TP2" count={stats.byTp.tp2} total={stats.signalCount} />
                <Dist label="TP3" count={stats.byTp.tp3} total={stats.signalCount} />
                <Dist label="BE" count={stats.byTp.be} total={stats.signalCount} />
                <Dist label="SL" count={stats.byTp.sl} total={stats.signalCount} />
              </div>
            </div>

            <div className="overflow-x-auto rounded border border-emerald-500/30">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-emerald-500/10 text-emerald-200">
                  <tr>
                    <th className="min-w-[165px] px-3 py-2">Timestamp</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Outcome</th>
                    <th className="px-3 py-2">Net Pips</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLogs.map((item) => (
                    <tr key={item.id} className="border-t border-emerald-500/20">
                      <td className="px-3 py-2">{formatDateTime(item.created_at)}</td>
                      <td className={`px-3 py-2 uppercase ${item.type === "buy" ? "text-emerald-300" : "text-red-400"}`}>{item.type}</td>
                      <td className="px-3 py-2 uppercase">{item.outcome}</td>
                      <td className={`px-3 py-2 ${item.net_pips >= 0 ? "text-emerald-300" : "text-red-400"}`}>{item.net_pips.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-emerald-300/70">
                <span>Rows:</span>
                <select
                  value={String(performancePageSize)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setPerformancePageSize(raw === "all" ? "all" : Number(raw));
                  }}
                  className="rounded border border-emerald-400/40 bg-transparent px-2 py-1 text-emerald-300"
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="all">Show All</option>
                </select>
              </div>
              <p className="text-emerald-300/70">
                Showing {visibleLogs.length} of {filteredLogs.length} records
              </p>
              <div className="flex items-center gap-2">
                {performancePageSize !== "all" && (
                  <span className="text-emerald-300/70">
                    Page {performancePage} / {totalPerformancePages}
                  </span>
                )}
                {performancePageSize !== "all" && (
                  <button
                    onClick={() => setPerformancePage((prev) => Math.max(1, prev - 1))}
                    disabled={performancePage <= 1}
                    className="rounded border border-emerald-400/40 px-3 py-1 text-emerald-300 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Prev
                  </button>
                )}
                {performancePageSize !== "all" && (
                  <button
                    onClick={() => setPerformancePage((prev) => Math.min(totalPerformancePages, prev + 1))}
                    disabled={performancePage >= totalPerformancePages}
                    className="rounded border border-emerald-400/40 px-3 py-1 text-emerald-300 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
      {showLoginDisclaimer && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-4">
          <div className={`w-full max-w-xl rounded-2xl border p-6 text-center ${isDark ? "border-emerald-400/30 bg-slate-900 text-emerald-100" : "border-[#0f172a]/20 bg-[#f8fafc] text-[#0f172a]"}`}>
            <h3 className={`text-xl font-bold ${isDark ? "text-emerald-200" : "text-[#1e3a8a]"}`}>Important Trading Disclaimer</h3>
            <div className={`mt-4 space-y-3 text-center text-sm leading-relaxed ${isDark ? "text-emerald-100/90" : "text-[#334155]"}`}>
              <p>Trading involves high risk, and past performance does not guarantee future results.</p>
              <p>You are fully responsible for your own trading decisions and risk management.</p>
              <p>By continuing, you acknowledge and accept these terms.</p>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => setShowLoginDisclaimer(false)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${isDark ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25" : "border border-[#2563eb]/40 bg-[#2563eb] text-white hover:bg-[#1d4ed8]"}`}
              >
                I Understand, Continue
              </button>
              <button
                onClick={logout}
                className="rounded-xl border border-red-400/50 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/10"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
      {activeSignalPopup && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 px-4">
          <div className={`w-full max-w-md rounded-2xl border p-5 text-center ${isDark ? "border-emerald-400/30 bg-slate-900 text-emerald-100" : "border-[#0f172a]/20 bg-[#f8fafc] text-[#0f172a]"}`}>
            <p className={`text-xs uppercase tracking-[0.16em] ${activeSignalPopup.kind === "sl" ? "text-red-400" : "text-emerald-300"}`}>Live Alert</p>
            <h3 className={`mt-1 text-xl font-bold ${isDark ? "text-emerald-200" : "text-[#1e3a8a]"}`}>{activeSignalPopup.title}</h3>
            <p className={`mt-3 text-sm ${isDark ? "text-emerald-100/90" : "text-[#334155]"}`}>{activeSignalPopup.message}</p>
            <button
              onClick={() => setActiveSignalPopup(null)}
              className={`mt-5 rounded-xl px-4 py-2 text-sm font-semibold ${isDark ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25" : "border border-[#2563eb]/40 bg-[#2563eb] text-white hover:bg-[#1d4ed8]"}`}
            >
              Close
            </button>
          </div>
        </div>
      )}
      {liveAlerts.length > 0 && (
        <div className="fixed right-3 top-3 z-30 w-[320px] max-w-[85vw] space-y-2">
          {liveAlerts.slice(0, 3).map((alert) => (
            <div key={alert.id} className={`rounded-xl border p-3 shadow-lg ${isDark ? "border-emerald-500/30 bg-slate-900/95" : "border-[#0f172a]/20 bg-[#f8fafc]/95"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={`text-xs uppercase tracking-[0.16em] ${alert.kind === "sl" ? "text-red-400" : "text-emerald-300"}`}>{alert.kind === "signal" ? "Signal" : alert.kind.toUpperCase()}</p>
                  <p className={`mt-0.5 text-sm font-semibold ${isDark ? "text-emerald-100" : "text-[#1e3a8a]"}`}>{alert.title}</p>
                  <p className={`mt-1 text-xs ${isDark ? "text-emerald-100/80" : "text-[#334155]"}`}>{alert.message}</p>
                </div>
                <button
                  onClick={() => setLiveAlerts((prev) => prev.filter((x) => x.id !== alert.id))}
                  className={`rounded border px-2 py-0.5 text-[10px] ${isDark ? "border-emerald-500/40 text-emerald-200" : "border-[#0f172a]/20 text-[#334155]"}`}
                >
                  X
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function Card({ title, value, meta, highlight = true, className = "", copyValue }: { title: string; value: string; meta?: string; highlight?: boolean; className?: string; copyValue?: string }) {
  const pipsMatch = value.match(/^(-?\d+(?:\.\d+)?)\s+pips$/i);
  const isCopyable = Boolean(copyValue);

  const handleCopy = async () => {
    if (!copyValue) return;
    await navigator.clipboard.writeText(copyValue);
  };

  return (
    <article
      className={`rounded border border-emerald-500/30 p-4 ${className} ${isCopyable ? "cursor-copy" : ""}`}
      onClick={isCopyable ? () => void handleCopy() : undefined}
      title={isCopyable ? `Copy ${title}` : undefined}
      role={isCopyable ? "button" : undefined}
      tabIndex={isCopyable ? 0 : undefined}
      onKeyDown={isCopyable ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void handleCopy();
        }
      } : undefined}
    >
      <p className="mb-1 text-xs uppercase tracking-[0.2em] text-emerald-300/70">{title}</p>
      <p className={`text-2xl ${highlight ? "text-emerald-300" : "text-red-400"}`}>
        {pipsMatch ? (
          <span className="inline-flex items-end gap-2">
            <span>{pipsMatch[1]}</span>
            <span className="text-lg lowercase tracking-normal opacity-90">pips</span>
          </span>
        ) : (
          value
        )}
      </p>
      {meta && <p className="mt-2 text-xs text-emerald-300/60">{meta}</p>}
    </article>
  );
}

function Level({ label, value, positive, danger, muted, copyable = false }: { label: string; value: number; positive?: boolean; danger?: boolean; muted?: boolean; copyable?: boolean }) {
  const color = danger ? "text-red-400 border-red-400/40" : positive ? "text-emerald-300 border-emerald-400/40" : "text-emerald-300/60 border-emerald-400/20";
  const handleCopy = async () => {
    await navigator.clipboard.writeText(fmt(value));
  };
  return (
    <div
      className={`rounded border p-2 ${color} ${muted ? "opacity-40" : ""} ${copyable ? "cursor-copy" : ""}`}
      onClick={copyable ? () => void handleCopy() : undefined}
      title={copyable ? `Copy ${label}` : undefined}
      role={copyable ? "button" : undefined}
      tabIndex={copyable ? 0 : undefined}
      onKeyDown={copyable ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void handleCopy();
        }
      } : undefined}
    >
      <p className="text-[10px] uppercase">{label}</p>
      <p>{fmt(value)}</p>
    </div>
  );
}

function Dist({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between"><span>{label}</span><span>{pct.toFixed(1)}%</span></div>
      <div className="h-2 rounded bg-emerald-950"><div className="h-2 rounded bg-emerald-400" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
