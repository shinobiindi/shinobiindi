# SHINOBI INDI SYSTEM (Tactical Command Version)

Trading Disiplin, Arahan Shinobi Indi.

## Stack
- Next.js (App Router + TypeScript)
- Tailwind CSS
- Lucide Icons
- Supabase (Auth key validation + Realtime stream)

## Setup
1. Install dependencies:
```bash
npm install
```
2. Create `.env.local` from `.env.example` and fill:
```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
TRADINGVIEW_WEBHOOK_SECRET=...
ADMIN_CRM_KEY=...
```
3. In Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql).
4. Start app:
```bash
npm run dev
```

## Admin CRM
- URL: `/admin`
- Header auth: `x-admin-key` checked against `ADMIN_CRM_KEY`
- Modules (v1):
  - Subscribers list + create
  - Performance logs list + manual adjustment + audit trail (`performance_log_edits`)
  - Package Links (create 7/15/30-day onboarding links)

## Client Onboarding Link
- URL format: `/register/[token]`
- Client fills `name`, `email`, `phone`
- System auto-generates a 12-character access key and sets expiry based on link duration

## TradingView Webhook
- Endpoint: `POST /api/webhook/tradingview`
- Recommended URL (production): `https://your-domain.com/api/webhook/tradingview`
- Secret: send in JSON `secret` (or header `x-webhook-secret`), must match `TRADINGVIEW_WEBHOOK_SECRET`

Example payload:
```json
{
  "event": "signal",
  "secret": "your-secret",
  "pair": "XAUUSD",
  "mode": "scalping",
  "type": "buy",
  "entry_target": 4556.42,
  "live_price": 4559.00,
  "sl": 4551.00,
  "tp1": 4562.00,
  "tp2": 4568.00,
  "tp3": 4575.00,
  "status": "active"
}
```

Live price heartbeat payload (update active signal only):
```json
{
  "event": "price_update",
  "secret": "your-secret",
  "pair": "XAUUSD",
  "mode": "scalping",
  "live_price": 4560.15
}
```

Note: `price_update` now auto-closes an active signal when TP/SL is touched and automatically inserts a `performance_logs` record using tracked peak pips.

Close signal payload (manual/backup flow):
```json
{
  "event": "signal_closed",
  "secret": "your-secret",
  "pair": "XAUUSD",
  "mode": "scalping",
  "close_price": 4563.25,
  "outcome": "tp2"
}
```

Accepted aliases:
- `symbol` for `pair`
- `strategy` for `mode`
- `side` for `type`
- `entry` for `entry_target`
- `price` for `live_price`
- `stop_loss` for `sl`

## Data Flow
- `access_keys`: login key, expiry, session token, and device fingerprint
- `subscribers`: CRM subscriber records
- `signals`: live XAUUSD tactical signals
- `performance_logs`: archival trading results
- `performance_log_edits`: audit trail for admin adjustments
- `security_alerts`: takeover and security alerts

TradingView webhook writes to `signals`; Supabase Realtime pushes updates instantly to UI.
