import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { resolveBrandId } from "@/lib/brand-id";

function parsePackageDays(packageName: string | undefined) {
  if (!packageName) return 0;
  if (/trial/i.test(packageName)) return 3;
  const match = packageName.match(/(\d+)\s*D/i);
  return match ? Number(match[1]) : 0;
}

function normalizePackageName(packageName: string | undefined) {
  if (!packageName) return "";
  const clean = packageName.trim();
  if (/trial/i.test(clean)) return "TRIAL 3D";
  return clean;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    email?: string;
    phone?: string | null;
    package_name?: string;
    status?: string;
    introducer?: string | null;
    key_expired_at?: string | null;
  };

  const patch: { name?: string; email?: string; phone?: string | null; package_name?: string; status?: string; introducer?: string | null } = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.email !== undefined) patch.email = body.email.trim().toLowerCase();
  if (body.phone !== undefined) patch.phone = body.phone?.trim() || null;
  if (body.introducer !== undefined) patch.introducer = body.introducer?.trim() || null;
  if (body.package_name !== undefined) patch.package_name = normalizePackageName(body.package_name);
  if (body.status !== undefined) patch.status = body.status;

  const { data, error } = await admin
    .from("subscribers")
    .update(patch)
    .eq("brand_id", brandId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const keyLabel = `${data.name} | ${data.package_name}`;
  const manualExpiry = body.key_expired_at === undefined ? undefined : (body.key_expired_at ? new Date(body.key_expired_at).toISOString() : null);

  if (body.status === "inactive") {
    const { error: keyError } = await admin
      .from("access_keys")
      .update({
        label: keyLabel,
        is_active: false,
        session_token: null,
        expired_at: manualExpiry === undefined ? new Date().toISOString() : manualExpiry,
      })
      .eq("brand_id", brandId)
      .eq("subscriber_id", id);
    if (keyError) return NextResponse.json({ error: keyError.message }, { status: 500 });
  }

  if (body.status === "active") {
    const { data: keyRow } = await admin
      .from("access_keys")
      .select("id,expired_at")
      .eq("brand_id", brandId)
      .eq("subscriber_id", id)
      .maybeSingle();

    let nextExpiry = keyRow?.expired_at ?? null;
    const packageDays = parsePackageDays(data.package_name);
    const packageChanged = body.package_name !== undefined;
    if (manualExpiry !== undefined) {
      nextExpiry = manualExpiry;
    } else if (packageDays > 0) {
      const nowMs = Date.now();
      if (packageChanged) {
        nextExpiry = new Date(nowMs + packageDays * 24 * 60 * 60 * 1000).toISOString();
      } else {
        const baseMs = nextExpiry ? new Date(nextExpiry).getTime() : 0;
        if (!baseMs || baseMs <= nowMs) {
          nextExpiry = new Date(nowMs + packageDays * 24 * 60 * 60 * 1000).toISOString();
        }
      }
    }

    const { error: keyError } = await admin
      .from("access_keys")
      .update({
        label: keyLabel,
        is_active: true,
        expired_at: nextExpiry,
      })
      .eq("brand_id", brandId)
      .eq("subscriber_id", id);
    if (keyError) return NextResponse.json({ error: keyError.message }, { status: 500 });
  }

  if (body.status === undefined) {
    const keyPatch: { label: string; expired_at?: string | null } = { label: keyLabel };
    if (manualExpiry !== undefined) keyPatch.expired_at = manualExpiry;
    else if (body.package_name !== undefined) {
      const packageDays = parsePackageDays(data.package_name);
      if (packageDays > 0) {
        keyPatch.expired_at = new Date(Date.now() + packageDays * 24 * 60 * 60 * 1000).toISOString();
      }
    }
    const { error: keyError } = await admin
      .from("access_keys")
      .update(keyPatch)
      .eq("brand_id", brandId)
      .eq("subscriber_id", id);
    if (keyError) return NextResponse.json({ error: keyError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
  const { id } = await params;

  const { error: keyDeleteError } = await admin.from("access_keys").delete().eq("brand_id", brandId).eq("subscriber_id", id);
  if (keyDeleteError) return NextResponse.json({ error: keyDeleteError.message }, { status: 500 });
  const { error } = await admin.from("subscribers").delete().eq("brand_id", brandId).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
