import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { generateAccessKey } from "@/lib/keygen";

function toPublicRegisterError(message: string) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("schema cache") &&
    (normalized.includes("public.link_redemptions") || normalized.includes("public.package_links"))
  ) {
    return "Registration database setup is incomplete. Run supabase/schema.sql in the Supabase SQL Editor, then try again.";
  }

  return message;
}

function internalError(message: string) {
  return NextResponse.json({ error: toPublicRegisterError(message) }, { status: 500 });
}

async function sendTelegramRegisterAlert(payload: {
  name: string;
  email: string;
  phone: string;
  packageName: string;
  durationDays: number;
  accessKey: string;
  expiredAt: string;
  linkToken: string;
  isExistingSubscriber: boolean;
}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const message = [
    "🚀 *New SHINOBI INDI Registration*",
    "",
    `*Name:* ${payload.name}`,
    `*Email:* ${payload.email}`,
    `*Phone:* ${payload.phone}`,
    `*Package:* ${payload.packageName} (${payload.durationDays} days)`,
    `*Status:* ${payload.isExistingSubscriber ? "Existing subscriber (renewed/updated)" : "New subscriber"}`,
    `*Access Key:* \`${payload.accessKey}\``,
    `*Expiry:* ${new Date(payload.expiredAt).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur" })}`,
    `*Token:* \`${payload.linkToken}\``,
  ].join("\n");

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  } catch {
    // swallow alert failure so registration flow is never blocked
  }
}

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });
  const { token } = await params;

  const { data, error } = await admin.from("package_links").select("package_name,duration_days,is_active,click_count,agent_name").eq("token", token).maybeSingle();
  if (error) return internalError(error.message);
  if (!data || !data.is_active) return NextResponse.json({ error: "Invalid or inactive link" }, { status: 404 });

  return NextResponse.json({ ok: true, package_name: data.package_name, duration_days: data.duration_days, agent_name: (data as { agent_name?: string | null }).agent_name ?? null });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });
  const { token } = await params;

  const body = (await req.json()) as { name?: string; email?: string; phone?: string };
  if (!body.name || !body.email || !body.phone) {
    return NextResponse.json({ error: "name, email and phone are required" }, { status: 400 });
  }
  const normalizedEmail = body.email.trim().toLowerCase();
  const normalizedName = body.name.trim().replace(/\s+/g, " ");
  const normalizedPhone = body.phone.trim();

  const nameParts = normalizedName.split(" ").filter(Boolean);
  if (
    normalizedName.length < 3 ||
    nameParts.length < 2 ||
    nameParts.some((p) => p.length < 2) ||
    !/^[A-Za-z\s'.-]+$/.test(normalizedName)
  ) {
    return NextResponse.json({ error: "Please enter a valid full name (first and last name)." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (!/^\+?[0-9]{9,15}$/.test(normalizedPhone)) {
    return NextResponse.json({ error: "Please enter a valid phone number (9-15 digits)." }, { status: 400 });
  }

  const { data: link, error: linkError } = await admin
    .from("package_links")
    .select("id,package_name,duration_days,is_active,agent_name")
    .eq("token", token)
    .maybeSingle();
  if (linkError) return internalError(linkError.message);
  if (!link || !link.is_active) return NextResponse.json({ error: "Invalid or inactive link" }, { status: 404 });

  const { data: priorRedemptionByEmail, error: priorRedemptionByEmailError } = await admin
    .from("link_redemptions")
    .select("id,subscriber_id")
    .eq("package_link_id", link.id)
    .eq("email_normalized", normalizedEmail)
    .limit(1)
    .maybeSingle();
  if (priorRedemptionByEmailError) return internalError(priorRedemptionByEmailError.message);

  const { data: priorRedemptionByPhone, error: priorRedemptionByPhoneError } = await admin
    .from("link_redemptions")
    .select("id,subscriber_id")
    .eq("package_link_id", link.id)
    .eq("phone_normalized", normalizedPhone)
    .limit(1)
    .maybeSingle();
  if (priorRedemptionByPhoneError) return internalError(priorRedemptionByPhoneError.message);

  if (priorRedemptionByEmail || priorRedemptionByPhone) {
    return NextResponse.json(
      {
        error: "Link already redeemed for this account. Please use a new package link for renewal.",
        duplicate_redeem: true,
      },
      { status: 409 },
    );
  }

  const extensionMs = Number(link.duration_days) * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  let subscriberId = "";
  let isExistingSubscriber = false;
  const { data: existingSub, error: existingSubError } = await admin.from("subscribers").select("id").eq("email", normalizedEmail).maybeSingle();
  if (existingSubError) return internalError(existingSubError.message);

  if (existingSub) {
    isExistingSubscriber = true;
    subscriberId = existingSub.id;
    await admin
      .from("subscribers")
      .update({
        name: normalizedName,
        phone: normalizedPhone,
        package_name: link.package_name,
        introducer: (link as { agent_name?: string | null }).agent_name ?? null,
        status: "active",
      })
      .eq("id", subscriberId);
  } else {
    const { data: sub, error: subError } = await admin
      .from("subscribers")
      .insert({
        name: normalizedName,
        email: normalizedEmail,
        phone: normalizedPhone,
        package_name: link.package_name,
        introducer: (link as { agent_name?: string | null }).agent_name ?? null,
        status: "active",
      })
      .select("id")
      .single();
    if (subError) return internalError(subError.message);
    subscriberId = sub.id;
  }

  const { data: existingKey, error: existingKeyError } = await admin
    .from("access_keys")
    .select("id,key,expired_at")
    .eq("subscriber_id", subscriberId)
    .maybeSingle();
  if (existingKeyError) return internalError(existingKeyError.message);

  let accessKey = existingKey?.key ?? "";
  let keyErrorMsg = "";
  let expiresAt = new Date(nowMs + extensionMs).toISOString();
  if (existingKey) {
    const currentExpiryMs = existingKey.expired_at ? new Date(existingKey.expired_at).getTime() : 0;
    const baseMs = currentExpiryMs > nowMs ? currentExpiryMs : nowMs;
    expiresAt = new Date(baseMs + extensionMs).toISOString();
    const { error } = await admin
      .from("access_keys")
      .update({
        expired_at: expiresAt,
        label: `${normalizedName} | ${link.package_name}`,
        is_active: true,
      })
      .eq("id", existingKey.id);
    if (error) keyErrorMsg = error.message;
  } else {
    for (let i = 0; i < 5; i += 1) {
      accessKey = generateAccessKey(12);
      const { error } = await admin.from("access_keys").insert({
        key: accessKey,
        label: `${normalizedName} | ${link.package_name}`,
        expired_at: expiresAt,
        is_active: true,
        subscriber_id: subscriberId,
      });
      if (!error) {
        keyErrorMsg = "";
        break;
      }
      keyErrorMsg = error.message;
    }
  }

  if (keyErrorMsg) return internalError(keyErrorMsg);

  const { error: redemptionInsertError } = await admin.from("link_redemptions").insert({
    package_link_id: link.id,
    subscriber_id: subscriberId,
    email_normalized: normalizedEmail,
    phone_normalized: normalizedPhone,
  });
  if (redemptionInsertError) {
    // If concurrent duplicate registration happened at same time, return duplicate status.
    if ((redemptionInsertError as { code?: string }).code === "23505") {
      return NextResponse.json(
        {
          error: "Link already redeemed for this account. Please use a new package link for renewal.",
          duplicate_redeem: true,
        },
        { status: 409 },
      );
    }
    return internalError(redemptionInsertError.message);
  }

  const { data: linkCounterData } = await admin
    .from("package_links")
    .select("click_count")
    .eq("token", token)
    .maybeSingle();

  await admin
    .from("package_links")
    .update({
      click_count: Number((linkCounterData as { click_count?: number } | null)?.click_count ?? 0) + 1,
      last_clicked_at: new Date().toISOString(),
    })
    .eq("token", token);

  await sendTelegramRegisterAlert({
    name: normalizedName,
    email: normalizedEmail,
    phone: normalizedPhone,
    packageName: link.package_name,
    durationDays: Number(link.duration_days),
    accessKey,
    expiredAt: expiresAt,
    linkToken: token,
    isExistingSubscriber,
  });

  return NextResponse.json({ ok: true, access_key: accessKey, expired_at: expiresAt, package_name: link.package_name, duration_days: link.duration_days });
}

