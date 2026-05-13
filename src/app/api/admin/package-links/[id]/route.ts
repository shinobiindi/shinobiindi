import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });
  const { id } = await params;

  const body = (await req.json()) as { is_active?: boolean; token?: string; agent_name?: string | null };

  const patch: { is_active?: boolean; token?: string; agent_name?: string | null } = {};
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
  if (body.token !== undefined) {
    const normalizedToken = body.token.trim();
    if (!/^[A-Za-z0-9]{4,64}$/.test(normalizedToken)) {
      return NextResponse.json({ error: "token must be 4-64 alphanumeric characters" }, { status: 400 });
    }
    patch.token = normalizedToken;
  }
  if (body.agent_name !== undefined) patch.agent_name = body.agent_name?.trim() || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Provide at least one field: is_active, token, or agent_name" }, { status: 400 });
  }

  const { data, error } = await admin.from("package_links").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });
  const { id } = await params;

  const { error } = await admin.from("package_links").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
