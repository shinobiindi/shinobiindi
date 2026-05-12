export type SignalMode = "scalping" | "intraday";

export type Signal = {
  id: string;
  created_at: string;
  updated_at: string;
  mode: SignalMode;
  type: "buy" | "sell";
  pair: string;
  entry_target: number;
  live_price: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number | null;
  max_floating_pips: number | null;
  status: "active" | "closed";
};

export type PerformanceLog = {
  id: string;
  created_at: string;
  mode: SignalMode;
  type: "buy" | "sell";
  outcome: "tp1" | "tp2" | "tp3" | "sl" | "be";
  net_pips: number;
  peak_pips: number | null;
};

export type AccessKey = {
  id: string;
  key: string;
  expired_at: string | null;
  is_active: boolean;
  fingerprint_id: string | null;
  session_token: string | null;
  last_login_at: string | null;
  label: string | null;
};
