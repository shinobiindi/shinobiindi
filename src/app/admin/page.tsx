"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Subscriber = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  introducer: string | null;
  package_name: string;
  status: string;
  access_key: string | null;
  key_expired_at: string | null;
  last_login_at: string | null;
  created_at: string;
};

type PerfLog = {
  id: string;
  created_at: string;
  mode: "scalping" | "intraday";
  type: "buy" | "sell";
  outcome: "tp1" | "tp2" | "tp3" | "sl" | "be";
  net_pips: number;
  peak_pips: number | null;
};

type PackageLink = {
  id: string;
  token: string;
  package_name: string;
  duration_days: number;
  agent_name: string | null;
  click_count: number;
  last_clicked_at: string | null;
  is_active: boolean;
  created_at: string;
};

type WebhookHealth = {
  latest_signal: {
    id: string;
    mode: "scalping" | "intraday";
    type: "buy" | "sell";
    status: string;
    created_at: string;
    updated_at: string | null;
  } | null;
  latest_performance: {
    id: string;
    mode: "scalping" | "intraday";
    type: "buy" | "sell";
    outcome: "tp1" | "tp2" | "tp3" | "sl" | "be";
    created_at: string;
  } | null;
  active_signal_count: number;
  signals_last_hour: number;
  signal_lag_seconds: number | null;
  performance_lag_seconds: number | null;
};

function formatAdminDate(value: string | null) {
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

function formatLag(seconds: number | null) {
  if (seconds === null) return "-";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const PERFORMANCE_EDIT_ENABLED = false;

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [tab, setTab] = useState<"subs" | "perf" | "links">("subs");
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [logs, setLogs] = useState<PerfLog[]>([]);
  const [links, setLinks] = useState<PackageLink[]>([]);
  const [health, setHealth] = useState<WebhookHealth | null>(null);
  const [status, setStatus] = useState<string>("");

  const [newSub, setNewSub] = useState({
    name: "",
    email: "",
    phone: "",
    introducer: "",
    package_name: "Package 7D",
  });
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [editSubDraft, setEditSubDraft] = useState({
    name: "",
    email: "",
    phone: "",
    introducer: "",
    package_name: "Package 7D",
    status: "active",
    key_expired_at: "",
  });
  const [editDraft, setEditDraft] = useState<Record<string, { outcome: PerfLog["outcome"]; net_pips: string; peak_pips: string; note: string }>>({});
  const [selectedPerfIds, setSelectedPerfIds] = useState<string[]>([]);
  const [newLink, setNewLink] = useState({ package_name: "Package 7D", duration_days: "7", agent_name: "" });
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editLinkDraft, setEditLinkDraft] = useState({ token: "", agent_name: "" });
  const [origin, setOrigin] = useState("");
  const [perfRange, setPerfRange] = useState<"day" | "week" | "month" | "custom">("week");
  const [perfMode, setPerfMode] = useState<"all" | "scalping" | "intraday">("all");
  const [perfFrom, setPerfFrom] = useState("");
  const [perfTo, setPerfTo] = useState("");
  const [subRowsPerPage, setSubRowsPerPage] = useState<number | "all">(10);
  const [subPage, setSubPage] = useState(1);
  const [perfRowsPerPage, setPerfRowsPerPage] = useState<number | "all">(10);
  const [perfPage, setPerfPage] = useState(1);
  const [importingPerfCsv, setImportingPerfCsv] = useState(false);
  const perfCsvInputRef = useRef<HTMLInputElement | null>(null);

  const headers = useMemo(() => ({ "x-admin-key": adminKey }), [adminKey]);

  const loadAll = useCallback(async () => {
    try {
      setStatus("Syncing admin data...");
      const [sRes, pRes, lRes, hRes] = await Promise.all([
        fetch("/api/admin/subscribers", { headers }),
        fetch("/api/admin/performance-logs", { headers }),
        fetch("/api/admin/package-links", { headers }),
        fetch("/api/admin/webhook-health", { headers }),
      ]);

      if (sRes.status === 401 || pRes.status === 401 || lRes.status === 401) {
        setAuthorized(false);
        setStatus("Unauthorized admin key.");
        return;
      }

      const [sJson, pJson, lJson, hJson] = await Promise.all([sRes.json(), pRes.json(), lRes.json(), hRes.json()]);
      if (!sRes.ok) throw new Error(sJson.error ?? "Failed loading subscribers.");
      if (!pRes.ok) throw new Error(pJson.error ?? "Failed loading performance logs.");
      if (!lRes.ok) throw new Error(lJson.error ?? "Failed loading package links.");
      if (!hRes.ok) throw new Error(hJson.error ?? "Failed loading webhook health.");
      if (!hJson?.ok) throw new Error(hJson?.error ?? "Failed loading webhook health.");

      setSubs(sJson.data ?? []);
      setLogs(pJson.data ?? []);
      setLinks(lJson.data ?? []);
      setHealth((hJson.data ?? null) as WebhookHealth | null);
      setAuthorized(true);
      setStatus("Admin data synced.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed syncing admin data.";
      setStatus(message);
    }
  }, [headers]);

  useEffect(() => {
    if (!authorized || !adminKey) return;
    void loadAll();
  }, [authorized, adminKey, loadAll]);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const perfStartMs = useMemo(() => {
    const now = new Date();
    if (perfRange === "day") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return start.getTime();
    }
    if (perfRange === "week") {
      const start = new Date(now);
      const jsDay = start.getDay();
      const daysFromMonday = (jsDay + 6) % 7;
      start.setDate(start.getDate() - daysFromMonday);
      start.setHours(0, 0, 0, 0);
      return start.getTime();
    }
    if (perfRange === "month") {
      return now.getTime() - 30 * 24 * 60 * 60 * 1000;
    }
    if (!perfFrom) return 0;
    return new Date(`${perfFrom}T00:00:00`).getTime();
  }, [perfRange, perfFrom]);

  const perfEndMs = useMemo(() => {
    if (perfRange !== "custom" || !perfTo) return Number.POSITIVE_INFINITY;
    return new Date(`${perfTo}T23:59:59`).getTime();
  }, [perfRange, perfTo]);

  const filteredPerfLogs = useMemo(() => {
    return logs.filter((l) => {
      if (perfMode !== "all" && l.mode !== perfMode) return false;
      const ts = new Date(l.created_at).getTime();
      return ts >= perfStartMs && ts <= perfEndMs;
    });
  }, [logs, perfMode, perfStartMs, perfEndMs]);

  const packageOptions = useMemo(() => {
    const names = new Set<string>(["Package 7D", "Package 15D", "Package 30D"]);
    for (const link of links) {
      const name = link.package_name?.trim();
      if (name) names.add(name);
    }
    const parseDays = (label: string) => {
      const match = label.match(/(\d+)\s*D/i);
      return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
    };
    return Array.from(names).sort((a, b) => {
      const ad = parseDays(a);
      const bd = parseDays(b);
      if (ad !== bd) return ad - bd;
      return a.localeCompare(b);
    });
  }, [links]);

  const totalPerfPages = useMemo(() => {
    if (perfRowsPerPage === "all") return 1;
    return Math.max(1, Math.ceil(filteredPerfLogs.length / perfRowsPerPage));
  }, [filteredPerfLogs.length, perfRowsPerPage]);

  const visiblePerfLogs = useMemo(() => {
    if (perfRowsPerPage === "all") return filteredPerfLogs;
    const start = (perfPage - 1) * perfRowsPerPage;
    return filteredPerfLogs.slice(start, start + perfRowsPerPage);
  }, [filteredPerfLogs, perfRowsPerPage, perfPage]);

  const subscriberOverview = useMemo(() => {
    const nowMs = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const weekAgoMs = nowMs - sevenDaysMs;

    const total = subs.length;
    const active = subs.filter((s) => s.status === "active").length;
    const inactive = subs.filter((s) => s.status !== "active").length;
    const expiringSoon = subs.filter((s) => {
      if (!s.key_expired_at) return false;
      const expiryMs = new Date(s.key_expired_at).getTime();
      return expiryMs >= nowMs && expiryMs <= nowMs + sevenDaysMs;
    }).length;
    const expiredKeys = subs.filter((s) => {
      if (!s.key_expired_at) return false;
      return new Date(s.key_expired_at).getTime() < nowMs;
    }).length;
    const loggedInToday = subs.filter((s) => {
      if (!s.last_login_at) return false;
      const d = new Date(s.last_login_at);
      const now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }).length;
    const newThisWeek = subs.filter((s) => new Date(s.created_at).getTime() >= weekAgoMs).length;
    const package7D = subs.filter((s) => /7D/i.test(s.package_name)).length;
    const package15D = subs.filter((s) => /15D/i.test(s.package_name)).length;
    const package30D = subs.filter((s) => /30D/i.test(s.package_name)).length;

    return {
      total,
      active,
      inactive,
      expiringSoon,
      expiredKeys,
      loggedInToday,
      newThisWeek,
      package7D,
      package15D,
      package30D,
    };
  }, [subs]);

  const totalSubPages = useMemo(() => {
    if (subRowsPerPage === "all") return 1;
    return Math.max(1, Math.ceil(subs.length / subRowsPerPage));
  }, [subs.length, subRowsPerPage]);

  const visibleSubs = useMemo(() => {
    if (subRowsPerPage === "all") return subs;
    const start = (subPage - 1) * subRowsPerPage;
    return subs.slice(start, start + subRowsPerPage);
  }, [subs, subRowsPerPage, subPage]);

  useEffect(() => {
    setSelectedPerfIds((prev) => prev.filter((id) => filteredPerfLogs.some((l) => l.id === id)));
  }, [filteredPerfLogs]);

  useEffect(() => {
    setSubPage(1);
  }, [subRowsPerPage]);

  useEffect(() => {
    if (subPage > totalSubPages) setSubPage(totalSubPages);
  }, [subPage, totalSubPages]);

  useEffect(() => {
    setPerfPage(1);
  }, [perfMode, perfRange, perfFrom, perfTo, perfRowsPerPage]);

  useEffect(() => {
    if (perfPage > totalPerfPages) setPerfPage(totalPerfPages);
  }, [perfPage, totalPerfPages]);

  const createSubscriber = async () => {
    const res = await fetch("/api/admin/subscribers", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(newSub),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error ?? "Failed creating subscriber.");
      return;
    }
    setStatus("Subscriber created.");
    setNewSub({ name: "", email: "", phone: "", introducer: "", package_name: "Package 7D" });
    await loadAll();
  };

  const startEditSubscriber = (s: Subscriber) => {
    const toLocalDatetimeInput = (value: string | null) => {
      if (!value) return "";
      const d = new Date(value);
      const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      return shifted.toISOString().slice(0, 16);
    };
    setEditingSubId(s.id);
    setEditSubDraft({
      name: s.name,
      email: s.email,
      phone: s.phone ?? "",
      introducer: s.introducer ?? "",
      package_name: s.package_name,
      status: s.status,
      key_expired_at: toLocalDatetimeInput(s.key_expired_at),
    });
  };

  const saveSubscriberEdit = async (id: string) => {
    const res = await fetch(`/api/admin/subscribers/${id}`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: editSubDraft.name,
        email: editSubDraft.email,
        phone: editSubDraft.phone || null,
        introducer: editSubDraft.introducer || null,
        package_name: editSubDraft.package_name,
        status: editSubDraft.status,
        key_expired_at: editSubDraft.key_expired_at ? new Date(editSubDraft.key_expired_at).toISOString() : null,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error ?? "Failed updating subscriber.");
      return;
    }
    setStatus("Subscriber updated.");
    setEditingSubId(null);
    await loadAll();
  };

  const deleteSubscriber = async (id: string) => {
    const ok = window.confirm("Delete this subscriber?");
    if (!ok) return;
    const res = await fetch(`/api/admin/subscribers/${id}`, { method: "DELETE", headers });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error ?? "Failed deleting subscriber.");
      return;
    }
    setStatus("Subscriber deleted.");
    if (editingSubId === id) setEditingSubId(null);
    await loadAll();
  };

  const saveLog = async (id: string) => {
    if (!PERFORMANCE_EDIT_ENABLED) {
      setStatus("Performance edit is disabled here. Please edit from HQ.");
      return;
    }
    const d = editDraft[id];
    if (!d) return;
    const res = await fetch(`/api/admin/performance-logs/${id}`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        outcome: d.outcome,
        net_pips: Number(d.net_pips),
        peak_pips: d.peak_pips === "" ? null : Number(d.peak_pips),
        note: d.note || "manual admin adjustment",
        actor: "admin_crm",
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error ?? "Failed updating log.");
      return;
    }
    setStatus("Performance log updated + audit saved.");
    await loadAll();
  };

  const deleteLog = async (id: string) => {
    if (!PERFORMANCE_EDIT_ENABLED) {
      setStatus("Performance delete is disabled here. Please manage from HQ.");
      return;
    }
    const ok = window.confirm("Delete this performance record?");
    if (!ok) return;
    const res = await fetch(`/api/admin/performance-logs/${id}`, { method: "DELETE", headers });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error ?? "Failed deleting performance log.");
      return;
    }
    setStatus("Performance log deleted.");
    setSelectedPerfIds((prev) => prev.filter((x) => x !== id));
    await loadAll();
  };

  const deleteSelectedLogs = async () => {
    if (!PERFORMANCE_EDIT_ENABLED) {
      setStatus("Performance bulk delete is disabled here. Please manage from HQ.");
      return;
    }
    if (!selectedPerfIds.length) return;
    const ok = window.confirm(`Delete ${selectedPerfIds.length} selected performance records?`);
    if (!ok) return;
    const res = await fetch("/api/admin/performance-logs", {
      method: "DELETE",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ ids: selectedPerfIds }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error ?? "Failed deleting selected logs.");
      return;
    }
    setStatus(`Deleted ${selectedPerfIds.length} performance records.`);
    setSelectedPerfIds([]);
    await loadAll();
  };

  const togglePerfSelection = (id: string, checked: boolean) => {
    setSelectedPerfIds((prev) => {
      if (checked) {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      }
      return prev.filter((x) => x !== id);
    });
  };

  const createLink = async () => {
    const res = await fetch("/api/admin/package-links", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ package_name: newLink.package_name, duration_days: Number(newLink.duration_days), agent_name: newLink.agent_name || null }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error ?? "Failed creating package link.");
      return;
    }
    setStatus("Package link created.");
    await loadAll();
  };

  const createPreset = async (days: number) => {
    const label = `Package ${days}D`;
    const res = await fetch("/api/admin/package-links", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ package_name: label, duration_days: days, agent_name: newLink.agent_name || null }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error ?? `Failed creating ${label}.`);
      return;
    }
    setStatus(`${label} link created.`);
    await loadAll();
  };

  const toggleLink = async (id: string, isActive: boolean) => {
    const res = await fetch(`/api/admin/package-links/${id}`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ is_active: !isActive }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error ?? "Failed updating link status.");
      return;
    }
    setStatus("Link status updated.");
    await loadAll();
  };

  const startEditLink = (link: PackageLink) => {
    setEditingLinkId(link.id);
    setEditLinkDraft({
      token: link.token,
      agent_name: link.agent_name ?? "",
    });
  };

  const cancelEditLink = () => {
    setEditingLinkId(null);
    setEditLinkDraft({ token: "", agent_name: "" });
  };

  const saveLinkEdit = async (id: string) => {
    const res = await fetch(`/api/admin/package-links/${id}`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        token: editLinkDraft.token,
        agent_name: editLinkDraft.agent_name || null,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error ?? "Failed updating package link.");
      return;
    }
    setStatus("Package link updated.");
    cancelEditLink();
    await loadAll();
  };

  const deleteLink = async (id: string) => {
    const ok = window.confirm("Delete this package link?");
    if (!ok) return;
    const res = await fetch(`/api/admin/package-links/${id}`, { method: "DELETE", headers });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error ?? "Failed deleting link.");
      return;
    }
    setStatus("Link deleted.");
    await loadAll();
  };

  const copyLink = async (token: string) => {
    const url = `${origin}/r/${token}`;
    await navigator.clipboard.writeText(url);
    setStatus("Register link copied.");
  };

  const exportPerfCsv = () => {
    const rows = filteredPerfLogs;
    const header = ["Time", "Mode", "Type", "Outcome", "Net Pips", "Peak Pips"];
    const csvRows = rows.map((r) => [
      formatAdminDate(r.created_at),
      r.mode,
      r.type,
      r.outcome.toUpperCase(),
      Number(r.net_pips).toFixed(1),
      r.peak_pips === null ? "" : Number(r.peak_pips).toFixed(1),
    ]);
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const content = [header, ...csvRows]
      .map((line) => line.map((v) => escapeCsv(String(v))).join(","))
      .join("\n");

    const blob = new Blob([`${content}\n`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `SHINOBI INDI-performance-${perfMode}-${perfRange}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${rows.length} performance rows.`);
  };

  const logoutAdmin = () => {
    setAuthorized(false);
    setAdminKey("");
    setStatus("Logged out.");
  };

  const importPerfCsv = async (file: File) => {
    if (!PERFORMANCE_EDIT_ENABLED) {
      setStatus("Performance CSV import is disabled here. Please import from HQ.");
      return;
    }
    if (!file) return;
    setImportingPerfCsv(true);
    try {
      const csv = await file.text();
      const res = await fetch("/api/admin/performance-logs", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus(json.error ?? "Failed importing performance CSV.");
        return;
      }
      setStatus(`Import done. Updated: ${json.updated ?? 0}, Inserted: ${json.inserted ?? 0}, Skipped: ${json.skipped ?? 0}.`);
      await loadAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed importing performance CSV.";
      setStatus(message);
    } finally {
      setImportingPerfCsv(false);
      if (perfCsvInputRef.current) perfCsvInputRef.current.value = "";
    }
  };

  if (!authorized) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
        <div className="mx-auto max-w-md rounded-xl border border-slate-700 bg-slate-900/70 p-5">
          <h1 className="text-xl font-bold">SHINOBI INDI Admin CRM</h1>
          <p className="mt-1 text-sm text-slate-400">Enter admin key</p>
          <input value={adminKey} onChange={(e) => setAdminKey(e.target.value)} className="mt-4 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2" />
          <button onClick={() => void loadAll()} className="mt-3 w-full rounded bg-blue-600 py-2 font-semibold">Unlock</button>
          {status && <p className="mt-3 text-sm text-rose-300">{status}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-5">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight">SHINOBI INDI Admin CRM</h1>
            <div className="flex flex-wrap gap-2">
              <a
                href="/access"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold hover:bg-indigo-600"
              >
                Signal
              </a>
              <button onClick={() => setTab("subs")} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === "subs" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"}`}>Subscribers</button>
              <button onClick={() => setTab("perf")} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === "perf" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"}`}>Performance Logs</button>
              <button onClick={() => setTab("links")} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === "links" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"}`}>Package Links</button>
              <button onClick={() => void loadAll()} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700">Refresh</button>
              <button onClick={logoutAdmin} className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold hover:bg-rose-600">Log Out</button>
            </div>
          </div>
        </header>

        {status && <p className="mb-4 text-sm text-sky-300">{status}</p>}

        {tab === "subs" ? (
          <section className="space-y-4">
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3"><p className="text-xs text-slate-400">Total Subscribers</p><p className="mt-1 text-lg font-semibold">{subscriberOverview.total}</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3"><p className="text-xs text-slate-400">Active Subscribers</p><p className="mt-1 text-lg font-semibold text-emerald-300">{subscriberOverview.active}</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3"><p className="text-xs text-slate-400">Inactive Subscribers</p><p className="mt-1 text-lg font-semibold text-rose-300">{subscriberOverview.inactive}</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3"><p className="text-xs text-slate-400">Expiring Soon (7D)</p><p className="mt-1 text-lg font-semibold">{subscriberOverview.expiringSoon}</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3"><p className="text-xs text-slate-400">Expired Keys</p><p className="mt-1 text-lg font-semibold text-rose-300">{subscriberOverview.expiredKeys}</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3"><p className="text-xs text-slate-400">Logged In Today</p><p className="mt-1 text-lg font-semibold">{subscriberOverview.loggedInToday}</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3"><p className="text-xs text-slate-400">New This Week</p><p className="mt-1 text-lg font-semibold">{subscriberOverview.newThisWeek}</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3"><p className="text-xs text-slate-400">Package 7D</p><p className="mt-1 text-lg font-semibold">{subscriberOverview.package7D}</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3"><p className="text-xs text-slate-400">Package 15D</p><p className="mt-1 text-lg font-semibold">{subscriberOverview.package15D}</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3"><p className="text-xs text-slate-400">Package 30D</p><p className="mt-1 text-lg font-semibold">{subscriberOverview.package30D}</p></div>
            </section>

            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
              <p className="mb-3 font-semibold">Create Subscriber</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <input placeholder="Name" value={newSub.name} onChange={(e) => setNewSub((s) => ({ ...s, name: e.target.value }))} className="rounded border border-slate-600 bg-slate-950 px-3 py-2" />
                <input placeholder="Email" value={newSub.email} onChange={(e) => setNewSub((s) => ({ ...s, email: e.target.value }))} className="rounded border border-slate-600 bg-slate-950 px-3 py-2" />
                <input placeholder="Phone" value={newSub.phone} onChange={(e) => setNewSub((s) => ({ ...s, phone: e.target.value }))} className="rounded border border-slate-600 bg-slate-950 px-3 py-2" />
                <input placeholder="Introducer" value={newSub.introducer} onChange={(e) => setNewSub((s) => ({ ...s, introducer: e.target.value }))} className="rounded border border-slate-600 bg-slate-950 px-3 py-2" />
                <select value={newSub.package_name} onChange={(e) => setNewSub((s) => ({ ...s, package_name: e.target.value }))} className="rounded border border-slate-600 bg-slate-950 px-3 py-2">
                  {packageOptions.map((pkg) => (
                    <option key={pkg} value={pkg}>{pkg}</option>
                  ))}
                </select>
              </div>
              <button onClick={() => void createSubscriber()} className="mt-3 rounded bg-emerald-600 px-3 py-2 font-semibold">Create</button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/60">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Rows:</span>
                  <select
                    value={String(subRowsPerPage)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setSubRowsPerPage(raw === "all" ? "all" : Number(raw));
                    }}
                    className="rounded border border-slate-600 bg-slate-950 px-2 py-2 text-xs"
                  >
                    <option value="10">10</option>
                    <option value="20">20</option>
                    <option value="30">30</option>
                    <option value="40">40</option>
                    <option value="50">50</option>
                    <option value="all">Show All</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400">
                    Showing {visibleSubs.length} of {subs.length} records
                  </span>
                  {subRowsPerPage !== "all" && (
                    <span className="text-xs text-slate-400">
                      Page {subPage} / {totalSubPages}
                    </span>
                  )}
                  {subRowsPerPage !== "all" && (
                    <button
                      onClick={() => setSubPage((prev) => Math.max(1, prev - 1))}
                      disabled={subPage <= 1}
                      className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800 disabled:opacity-40"
                    >
                      Prev
                    </button>
                  )}
                  {subRowsPerPage !== "all" && (
                    <button
                      onClick={() => setSubPage((prev) => Math.min(totalSubPages, prev + 1))}
                      disabled={subPage >= totalSubPages}
                      className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800 disabled:opacity-40"
                    >
                      Next
                    </button>
                  )}
                </div>
              </div>
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800/80">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Introducer</th>
                    <th className="px-3 py-2">Package</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Access Key</th>
                    <th className="px-3 py-2">Last Login</th>
                    <th className="px-3 py-2">Key Expiry</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSubs.map((s) => (
                    <tr key={s.id} className="border-t border-slate-800">
                      <td className="px-3 py-2">
                        {editingSubId === s.id ? (
                          <input value={editSubDraft.name} onChange={(e) => setEditSubDraft((d) => ({ ...d, name: e.target.value }))} className="w-40 rounded border border-slate-600 bg-slate-950 px-2 py-1" />
                        ) : s.name}
                      </td>
                      <td className="px-3 py-2">
                        {editingSubId === s.id ? (
                          <input value={editSubDraft.email} onChange={(e) => setEditSubDraft((d) => ({ ...d, email: e.target.value }))} className="w-48 rounded border border-slate-600 bg-slate-950 px-2 py-1" />
                        ) : s.email}
                      </td>
                      <td className="px-3 py-2">
                        {editingSubId === s.id ? (
                          <input value={editSubDraft.phone} onChange={(e) => setEditSubDraft((d) => ({ ...d, phone: e.target.value }))} className="w-32 rounded border border-slate-600 bg-slate-950 px-2 py-1" />
                        ) : (s.phone ?? "-")}
                      </td>
                      <td className="px-3 py-2">
                        {editingSubId === s.id ? (
                          <input value={editSubDraft.introducer} onChange={(e) => setEditSubDraft((d) => ({ ...d, introducer: e.target.value }))} className="w-36 rounded border border-slate-600 bg-slate-950 px-2 py-1" />
                        ) : (s.introducer ?? "-")}
                      </td>
                      <td className="px-3 py-2">
                        {editingSubId === s.id ? (
                          <select value={editSubDraft.package_name} onChange={(e) => setEditSubDraft((d) => ({ ...d, package_name: e.target.value }))} className="w-32 rounded border border-slate-600 bg-slate-950 px-2 py-1">
                            {packageOptions.map((pkg) => (
                              <option key={pkg} value={pkg}>{pkg}</option>
                            ))}
                          </select>
                        ) : s.package_name}
                      </td>
                      <td className="px-3 py-2">
                        {editingSubId === s.id ? (
                          <select value={editSubDraft.status} onChange={(e) => setEditSubDraft((d) => ({ ...d, status: e.target.value }))} className="w-24 rounded border border-slate-600 bg-slate-950 px-2 py-1">
                            <option value="active">active</option>
                            <option value="inactive">inactive</option>
                          </select>
                        ) : s.status}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{s.access_key ?? "-"}</td>
                      <td className="px-3 py-2 text-xs">{formatAdminDate(s.last_login_at)}</td>
                      <td className="px-3 py-2 text-xs">
                        {editingSubId === s.id ? (
                          <input
                            type="datetime-local"
                            value={editSubDraft.key_expired_at}
                            onChange={(e) => setEditSubDraft((d) => ({ ...d, key_expired_at: e.target.value }))}
                            className="w-44 rounded border border-slate-600 bg-slate-950 px-2 py-1"
                          />
                        ) : (
                          formatAdminDate(s.key_expired_at)
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editingSubId === s.id ? (
                          <div className="flex gap-1">
                            <button onClick={() => void saveSubscriberEdit(s.id)} className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold hover:bg-emerald-500">Save</button>
                            <button onClick={() => setEditingSubId(null)} className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold hover:bg-slate-600">Cancel</button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <button onClick={() => startEditSubscriber(s)} className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold hover:bg-blue-500">Edit</button>
                            <button onClick={() => void deleteSubscriber(s.id)} className="rounded bg-rose-700 px-3 py-1 text-xs font-semibold hover:bg-rose-600">Delete</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : tab === "perf" ? (
          <section className="space-y-3">
            {health && (
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                  <p className="text-xs text-slate-400">Last Signal</p>
                  <p className="mt-1 text-sm font-semibold">{health.latest_signal ? `${health.latest_signal.mode} ${health.latest_signal.type}` : "-"}</p>
                  <p className="text-xs text-slate-400">{health.latest_signal ? formatAdminDate(health.latest_signal.updated_at ?? health.latest_signal.created_at) : "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                  <p className="text-xs text-slate-400">Last Signal Lag</p>
                  <p className="mt-1 text-sm font-semibold">{formatLag(health.signal_lag_seconds)}</p>
                  <p className="text-xs text-slate-400">Signals in 1h: {health.signals_last_hour}</p>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                  <p className="text-xs text-slate-400">Last Performance</p>
                  <p className="mt-1 text-sm font-semibold">{health.latest_performance ? health.latest_performance.outcome.toUpperCase() : "-"}</p>
                  <p className="text-xs text-slate-400">{health.latest_performance ? formatAdminDate(health.latest_performance.created_at) : "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                  <p className="text-xs text-slate-400">Active Signals</p>
                  <p className="mt-1 text-sm font-semibold">{health.active_signal_count}</p>
                  <p className="text-xs text-slate-400">Perf lag: {formatLag(health.performance_lag_seconds)}</p>
                </div>
              </section>
            )}

            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-2">
                  <select
                    value={perfMode}
                    onChange={(e) => setPerfMode(e.target.value as "all" | "scalping" | "intraday")}
                    className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="all">All Modes</option>
                    <option value="scalping">Scalping</option>
                    <option value="intraday">Intraday</option>
                  </select>
                  <button onClick={() => setPerfRange("day")} className={`rounded border px-3 py-2 text-xs font-semibold ${perfRange === "day" ? "border-blue-400 bg-blue-600 text-white" : "border-slate-600 bg-slate-900 hover:bg-slate-800"}`}>Day</button>
                  <button onClick={() => setPerfRange("week")} className={`rounded border px-3 py-2 text-xs font-semibold ${perfRange === "week" ? "border-blue-400 bg-blue-600 text-white" : "border-slate-600 bg-slate-900 hover:bg-slate-800"}`}>Week</button>
                  <button onClick={() => setPerfRange("month")} className={`rounded border px-3 py-2 text-xs font-semibold ${perfRange === "month" ? "border-blue-400 bg-blue-600 text-white" : "border-slate-600 bg-slate-900 hover:bg-slate-800"}`}>Month</button>
                  <button onClick={() => setPerfRange("custom")} className={`rounded border px-3 py-2 text-xs font-semibold ${perfRange === "custom" ? "border-blue-400 bg-blue-600 text-white" : "border-slate-600 bg-slate-900 hover:bg-slate-800"}`}>Custom</button>
                  {perfRange === "custom" && (
                    <>
                      <input type="date" value={perfFrom} onChange={(e) => setPerfFrom(e.target.value)} className="rounded border border-slate-600 bg-slate-950 px-2 py-2 text-xs" />
                      <input type="date" value={perfTo} onChange={(e) => setPerfTo(e.target.value)} className="rounded border border-slate-600 bg-slate-950 px-2 py-2 text-xs" />
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Rows:</span>
                      <select
                        value={String(perfRowsPerPage)}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setPerfRowsPerPage(raw === "all" ? "all" : Number(raw));
                        }}
                        className="rounded border border-slate-600 bg-slate-950 px-2 py-2 text-xs"
                      >
                        <option value="10">10</option>
                        <option value="20">20</option>
                        <option value="30">30</option>
                        <option value="40">40</option>
                        <option value="50">50</option>
                        <option value="all">Show All</option>
                      </select>
                    </div>
                    <button
                      onClick={exportPerfCsv}
                      className="rounded border border-emerald-500 bg-emerald-700 px-3 py-2 text-xs font-semibold hover:bg-emerald-600"
                    >
                      Export CSV
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">
                      Showing {visiblePerfLogs.length} of {filteredPerfLogs.length} records
                    </span>
                    {perfRowsPerPage !== "all" && (
                      <span className="text-xs text-slate-400">
                        Page {perfPage} / {totalPerfPages}
                      </span>
                    )}
                    {perfRowsPerPage !== "all" && (
                      <button
                        onClick={() => setPerfPage((prev) => Math.max(1, prev - 1))}
                        disabled={perfPage <= 1}
                        className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800 disabled:opacity-40"
                      >
                        Prev
                      </button>
                    )}
                    {perfRowsPerPage !== "all" && (
                      <button
                        onClick={() => setPerfPage((prev) => Math.min(totalPerfPages, prev + 1))}
                        disabled={perfPage >= totalPerfPages}
                        className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800 disabled:opacity-40"
                      >
                        Next
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <section className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/60">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800/80">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">Net Pips</th>
                  <th className="px-3 py-2">Peak Pips</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {visiblePerfLogs.map((l) => {
                  return (
                    <tr key={l.id} className="border-t border-slate-800">
                      <td className="px-3 py-2">{formatAdminDate(l.created_at)}</td>
                      <td className="px-3 py-2">{l.mode}</td>
                      <td className="px-3 py-2">{l.type}</td>
                      <td className="px-3 py-2">{l.outcome.toUpperCase()}</td>
                      <td className="px-3 py-2">{Number(l.net_pips).toFixed(1)}</td>
                      <td className="px-3 py-2">{l.peak_pips === null ? "-" : Number(l.peak_pips).toFixed(1)}</td>
                      <td className="px-3 py-2 text-slate-400">-</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </section>
          </section>
        ) : (
          <section className="space-y-4">
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-5">
              <p className="mb-3 text-lg font-semibold tracking-tight">Create Package Link</p>
              <p className="mb-3 text-sm text-slate-400">One-click presets</p>
              <div className="mb-4 flex flex-wrap gap-2">
                <button onClick={() => void createPreset(7)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500">Create 7D</button>
                <button onClick={() => void createPreset(15)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500">Create 15D</button>
                <button onClick={() => void createPreset(30)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500">Create 30D</button>
              </div>
              <p className="mb-2 text-sm text-slate-400">Custom link</p>
              <div className="grid gap-2 sm:grid-cols-4">
                <input value={newLink.package_name} onChange={(e) => setNewLink((s) => ({ ...s, package_name: e.target.value }))} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" />
                <input value={newLink.duration_days} onChange={(e) => setNewLink((s) => ({ ...s, duration_days: e.target.value }))} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" />
                <input placeholder="Agent name" value={newLink.agent_name} onChange={(e) => setNewLink((s) => ({ ...s, agent_name: e.target.value }))} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" />
                <button onClick={() => void createLink()} className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold hover:bg-emerald-500">Create Link</button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/60">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800/80">
                  <tr>
                    <th className="px-3 py-2">Package</th>
                    <th className="px-3 py-2">Days</th>
                    <th className="px-3 py-2">Token</th>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Clicks</th>
                    <th className="px-3 py-2">Last Click</th>
                    <th className="px-3 py-2">Register Link</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => (
                    <tr key={l.id} className="border-t border-slate-800">
                      <td className="px-3 py-2">{l.package_name}</td>
                      <td className="px-3 py-2">{l.duration_days}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {editingLinkId === l.id ? (
                          <input
                            value={editLinkDraft.token}
                            onChange={(e) => setEditLinkDraft((s) => ({ ...s, token: e.target.value }))}
                            className="w-40 rounded border border-slate-600 bg-slate-950 px-2 py-1"
                          />
                        ) : (
                          l.token
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editingLinkId === l.id ? (
                          <input
                            value={editLinkDraft.agent_name}
                            onChange={(e) => setEditLinkDraft((s) => ({ ...s, agent_name: e.target.value }))}
                            className="w-36 rounded border border-slate-600 bg-slate-950 px-2 py-1"
                          />
                        ) : (
                          l.agent_name ?? "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${l.is_active ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
                          {l.is_active ? "active" : "inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2">{l.click_count ?? 0}</td>
                      <td className="px-3 py-2 text-xs">{formatAdminDate(l.last_clicked_at)}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        <div className="max-w-[420px] truncate">{`${origin}/r/${l.token}`}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          {editingLinkId === l.id ? (
                            <>
                              <button onClick={() => void saveLinkEdit(l.id)} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold hover:bg-emerald-500">Save</button>
                              <button onClick={cancelEditLink} className="rounded-lg bg-slate-700 px-2 py-1 text-xs font-semibold hover:bg-slate-600">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => void copyLink(l.token)} className="rounded-lg bg-slate-700 px-2 py-1 text-xs font-semibold hover:bg-slate-600">Copy</button>
                              <button onClick={() => startEditLink(l)} className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-semibold hover:bg-blue-500">Edit</button>
                              <button onClick={() => void toggleLink(l.id, l.is_active)} className={`rounded-lg px-2 py-1 text-xs font-semibold ${l.is_active ? "bg-rose-600 hover:bg-rose-500" : "bg-emerald-600 hover:bg-emerald-500"}`}>
                                {l.is_active ? "Disable" : "Enable"}
                              </button>
                              <button onClick={() => void deleteLink(l.id)} className="rounded-lg bg-rose-900 px-2 py-1 text-xs font-semibold hover:bg-rose-800">Delete</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
