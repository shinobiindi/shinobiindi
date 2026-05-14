import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { generateToken } from "@/lib/keygen";
import { resolveBrandId } from "@/lib/brand-id";

type PackageLinkRow = Record<string, unknown> & {
  package_name?: string | null;
  duration_days?: number | string | null;
};

function readDurationDays(row: PackageLinkRow, fallback = 7) {
  const explicit = Number(row.duration_days);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);

  const match = String(row.package_name ?? "").match(/(?:^|\D)(\d{1,4})\s*d(?:ays?)?/i);
  if (match) return Number(match[1]);

  return fallback;
}

function normalizePackageName(rawName: string, durationDays: number) {
  if (/trial/i.test(rawName) || durationDays === 3) {
    return "TRIAL 3D";
  }
  const clean = rawName.trim();
  if (/^package\s*\d+\s*d$/i.test(clean)) {
    const match = clean.match(/(\d+)/);
    return `Package ${Number(match?.[1] ?? durationDays)}D`;
  }
  return clean;
}

function packageNameWithDuration(packageName: string, durationDays: number) {
  const normalized = normalizePackageName(packageName, durationDays);
  if (normalized === "TRIAL 3D") return normalized;
  if (/(?:^|\D)\d{1,4}\s*d(?:ays?)?/i.test(normalized)) return normalized;
  return `${normalized} ${durationDays}D`;
}

function normalizeLink(row: PackageLinkRow) {
  const duration = readDurationDays(row);
  const name = normalizePackageName(String(row.package_name ?? ""), duration);
  return {
    ...row,
    package_name: name,
    duration_days: name === "TRIAL 3D" ? 3 : duration,
  };
}

export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
  const { data, error } = await admin
    .from("package_links")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: (data ?? []).map((row) => normalizeLink(row as PackageLinkRow)) });
}

export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
  const body = (await req.json()) as { package_name?: string; duration_days?: number; agent_name?: string };
  let duration = Number(body.duration_days ?? 0);
  const rawPackageName = body.package_name?.trim() ?? "";
  if (!rawPackageName || !duration || duration <= 0) {
    return NextResponse.json({ error: "package_name and duration_days are required" }, { status: 400 });
  }

  if (/trial/i.test(rawPackageName)) {
    duration = 3;
  }

  const packageName = packageNameWithDuration(rawPackageName, Math.round(duration));
  const MAX_RETRIES = 12;
  for (let i = 0; i < MAX_RETRIES; i += 1) {
    const token = generateToken(4);
    const { data, error } = await admin
      .from("package_links")
      .insert({
        brand_id: brandId,
        token,
        package_name: packageName,
        agent_name: body.agent_name?.trim() || null,
        is_active: true,
      })
      .select("*")
      .single();

    if (!error) return NextResponse.json({ ok: true, data: normalizeLink(data as PackageLinkRow) });
    if (error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: "Token collision. Please retry." }, { status: 500 });
}
