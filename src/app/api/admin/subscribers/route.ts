import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { resolveBrandId } from "@/lib/brand-id";

export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
  const { data: subs, error } = await admin
    .from("subscribers")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (subs ?? []).map((s) => s.id);
  const { data: keys } = ids.length
    ? await admin
      .from("access_keys")
      .select("subscriber_id,key,expired_at,last_login_at")
      .eq("brand_id", brandId)
      .in("subscriber_id", ids)
    : { data: [] as { subscriber_id: string; key: string; expired_at: string | null; last_login_at: string | null }[] };

  const keyMap = new Map((keys ?? []).map((k) => [k.subscriber_id, { key: k.key, expired_at: k.expired_at, last_login_at: k.last_login_at }]));
  const merged = (subs ?? []).map((s) => ({
    ...s,
    access_key: keyMap.get(s.id)?.key ?? null,
    key_expired_at: keyMap.get(s.id)?.expired_at ?? null,
    last_login_at: keyMap.get(s.id)?.last_login_at ?? null,
  }));

  return NextResponse.json({ ok: true, data: merged });
}

export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
  const body = (await req.json()) as { name?: string; email?: string; phone?: string; package_name?: string; status?: string; introducer?: string };
  if (!body.name || !body.email || !body.package_name) {
    return NextResponse.json({ error: "name, email, package_name are required" }, { status: 400 });
  }
  const normalizedEmail = body.email.trim().toLowerCase();
  const normalizedName = body.name.trim();
  const normalizedPhone = body.phone?.trim() || null;
  const normalizedIntroducer = body.introducer?.trim() || null;

  const { data: existing } = await admin
    .from("subscribers")
    .select("*")
    .eq("brand_id", brandId)
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (existing) return NextResponse.json({ error: "Subscriber email already exists" }, { status: 409 });

  const { data, error } = await admin
    .from("subscribers")
    .insert({
      brand_id: brandId,
      name: normalizedName,
      email: normalizedEmail,
      phone: normalizedPhone,
      introducer: normalizedIntroducer,
      package_name: body.package_name,
      status: body.status ?? "active",
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}
