import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type AccessKeySessionRow = {
  id: string;
  expired_at: string | null;
  is_active: boolean;
  session_token: string | null;
};

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Server authorization is not configured.", code: "server_not_configured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body.", code: "bad_request" }, { status: 400 });
  }

  const payload = body as { accessKeyId?: unknown; sessionToken?: unknown };
  const accessKeyId = readText(payload.accessKeyId);
  const sessionToken = readText(payload.sessionToken);

  if (!accessKeyId || !sessionToken) {
    return NextResponse.json({ error: "Session identity is required.", code: "bad_request" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("access_keys")
    .select("id,expired_at,is_active,session_token")
    .eq("id", accessKeyId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Access key revoked. Please contact admin.", code: "revoked" }, { status: 401 });
  }

  const row = data as AccessKeySessionRow;
  if (!row.is_active) {
    return NextResponse.json({ error: "Access key inactive. Please contact admin.", code: "inactive" }, { status: 403 });
  }

  if (row.expired_at && new Date(row.expired_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Access key expired. Please contact admin.", code: "expired" }, { status: 403 });
  }

  if (row.session_token !== sessionToken) {
    return NextResponse.json({ error: "Session moved to another device. Please authorize again.", code: "session_moved" }, { status: 409 });
  }

  return NextResponse.json({
    data: {
      id: row.id,
      expired_at: row.expired_at,
    },
  });
}
