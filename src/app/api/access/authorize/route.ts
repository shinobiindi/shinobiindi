import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { resolveBrandId } from "@/lib/brand-id";

type AccessKeyRow = {
  id: string;
  label: string | null;
  expired_at: string | null;
  is_active: boolean;
  fingerprint_id: string | null;
};

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function createSessionToken() {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Server authorization is not configured." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const brandId = resolveBrandId(req);
  const payload = body as { key?: unknown; fingerprint?: unknown };
  const key = readText(payload.key);
  const fingerprint = readText(payload.fingerprint);

  if (!key || !fingerprint) {
    return NextResponse.json({ error: "Access key and fingerprint are required." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("access_keys")
    .select("id,label,expired_at,is_active,fingerprint_id")
    .eq("brand_id", brandId)
    .eq("key", key)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Authorization denied: invalid key." }, { status: 401 });
  }

  const row = data as AccessKeyRow;
  if (!row.is_active) {
    return NextResponse.json({ error: "Authorization denied: key inactive." }, { status: 403 });
  }

  if (row.expired_at && new Date(row.expired_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Authorization denied: key expired." }, { status: 403 });
  }

  if (row.fingerprint_id && row.fingerprint_id !== fingerprint) {
    await admin.from("security_alerts").insert({
      brand_id: brandId,
      access_key_id: row.id,
      key,
      reason: "session_takeover",
      fingerprint_id: fingerprint,
      user_agent: req.headers.get("user-agent"),
      ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
  }

  const sessionToken = createSessionToken();
  const { error: updateError } = await admin
    .from("access_keys")
    .update({
      fingerprint_id: fingerprint,
      session_token: sessionToken,
      last_login_at: new Date().toISOString(),
    })
    .eq("brand_id", brandId)
    .eq("id", row.id);

  if (updateError) {
    return NextResponse.json({ error: "Authorization denied: failed to open new session." }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      id: row.id,
      label: row.label,
      expired_at: row.expired_at,
      session_token: sessionToken,
    },
  });
}
