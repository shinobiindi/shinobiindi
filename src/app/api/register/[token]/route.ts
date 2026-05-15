import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { generateAccessKey } from "@/lib/keygen";
import { resolveBrandId } from "@/lib/brand-id";

type PackageLinkRow = Record<string, unknown> & {
  id: string;
  package_name: string;
  is_active: boolean;
  duration_days?: number | string | null;
  agent_name?: string | null;
  expires_at?: string | null;
  max_redemptions?: number | string | null;
  redemptions_count?: number | string | null;
  click_count?: number | string | null;
};
type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

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

function brandDisplayName(brandId: string) {
  const labels: Record<string, string> = {
    kafra: "KAFRA SIGNAL",
    sarjan: "SARJAN SIGNAL",
    richjoker: "RICH JOKER",
    shinobi: "SHINOBI INDI",
  };
  return labels[brandId] ?? brandId.toUpperCase();
}

function readDurationDays(row: PackageLinkRow, fallback = 7) {
  const explicit = Number(row.duration_days);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);

  const match = String(row.package_name ?? "").match(/(?:^|\D)(\d{1,4})\s*d(?:ays?)?/i);
  if (match) return Number(match[1]);

  return fallback;
}

function isLinkUnavailable(link: PackageLinkRow) {
  if (!link.is_active) return "Invalid or inactive link";

  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return "This registration link has expired";
  }

  const maxRedemptions = Number(link.max_redemptions);
  const redemptionsCount = Number(link.redemptions_count ?? 0);
  if (Number.isFinite(maxRedemptions) && maxRedemptions > 0 && redemptionsCount >= maxRedemptions) {
    return "This registration link has reached its redemption limit";
  }

  return null;
}

async function sendTelegramRegisterAlert(payload: {
  admin: AdminClient;
  brandId: string;
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
  let botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  let chatId = process.env.TELEGRAM_CHAT_ID?.trim() ?? "";

  try {
    const { data } = await payload.admin
      .from("telegram_bots")
      .select("bot_token_secret_ref, channel_id, is_active")
      .eq("brand_id", payload.brandId)
      .eq("bot_name", "registration_alert")
      .maybeSingle();

    if (data?.is_active !== false) {
      const dbToken =
        typeof data?.bot_token_secret_ref === "string" ? data.bot_token_secret_ref.trim() : "";
      const dbChatId = typeof data?.channel_id === "string" ? data.channel_id.trim() : "";
      if (dbToken && dbChatId) {
        botToken = dbToken;
        chatId = dbChatId;
      }
    }
  } catch {
    // Fallback to env token/chat id if config read fails.
  }

  if (!botToken || !chatId) return;

  const message = [
    `*New ${brandDisplayName(payload.brandId)} Registration*`,
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
    // Alert failures must not block registration.
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
  const { token } = await params;
  const { data, error } = await admin
    .from("package_links")
    .select("*")
    .eq("brand_id", brandId)
    .eq("token", token)
    .maybeSingle();

  if (error) return internalError(error.message);
  if (!data) return NextResponse.json({ error: "Invalid or inactive link" }, { status: 404 });

  const link = data as PackageLinkRow;
  const unavailable = isLinkUnavailable(link);
  if (unavailable) return NextResponse.json({ error: unavailable }, { status: 404 });

  return NextResponse.json({
    ok: true,
    package_name: link.package_name,
    duration_days: readDurationDays(link),
    agent_name: link.agent_name ?? null,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Missing admin env" }, { status: 500 });

  const brandId = resolveBrandId(req);
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

  const { data: linkData, error: linkError } = await admin
    .from("package_links")
    .select("*")
    .eq("brand_id", brandId)
    .eq("token", token)
    .maybeSingle();
  if (linkError) return internalError(linkError.message);
  if (!linkData) return NextResponse.json({ error: "Invalid or inactive link" }, { status: 404 });

  const link = linkData as PackageLinkRow;
  const unavailable = isLinkUnavailable(link);
  if (unavailable) return NextResponse.json({ error: unavailable }, { status: 404 });

  const { data: priorRedemptionByEmail, error: priorRedemptionByEmailError } = await admin
    .from("link_redemptions")
    .select("id,subscriber_id")
    .eq("brand_id", brandId)
    .eq("package_link_id", link.id)
    .eq("email_normalized", normalizedEmail)
    .limit(1)
    .maybeSingle();
  if (priorRedemptionByEmailError) return internalError(priorRedemptionByEmailError.message);

  const { data: priorRedemptionByPhone, error: priorRedemptionByPhoneError } = await admin
    .from("link_redemptions")
    .select("id,subscriber_id")
    .eq("brand_id", brandId)
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

  const durationDays = readDurationDays(link);
  const extensionMs = durationDays * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  let subscriberId = "";
  let isExistingSubscriber = false;
  const { data: existingSub, error: existingSubError } = await admin
    .from("subscribers")
    .select("id")
    .eq("brand_id", brandId)
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (existingSubError) return internalError(existingSubError.message);

  if (existingSub) {
    isExistingSubscriber = true;
    subscriberId = existingSub.id;
    const { error: subUpdateError } = await admin
      .from("subscribers")
      .update({
        name: normalizedName,
        phone: normalizedPhone,
        package_name: link.package_name,
        introducer: link.agent_name ?? null,
        status: "active",
      })
      .eq("brand_id", brandId)
      .eq("id", subscriberId);
    if (subUpdateError) return internalError(subUpdateError.message);
  } else {
    const { data: sub, error: subError } = await admin
      .from("subscribers")
      .insert({
        brand_id: brandId,
        name: normalizedName,
        email: normalizedEmail,
        phone: normalizedPhone,
        package_name: link.package_name,
        introducer: link.agent_name ?? null,
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
    .eq("brand_id", brandId)
    .eq("subscriber_id", subscriberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingKeyError) return internalError(existingKeyError.message);

  let accessKey = existingKey?.key ?? "";
  let accessKeyId = existingKey?.id ?? "";
  let keyErrorMsg = "";
  let expiresAt = new Date(nowMs + extensionMs).toISOString();
  if (existingKey) {
    // Register link should apply exact package duration from now,
    // not stack on top of remaining active expiry.
    expiresAt = new Date(nowMs + extensionMs).toISOString();
    const { error } = await admin
      .from("access_keys")
      .update({
        expired_at: expiresAt,
        label: `${normalizedName} | ${link.package_name}`,
        is_active: true,
      })
      .eq("brand_id", brandId)
      .eq("id", existingKey.id);
    if (error) keyErrorMsg = error.message;
  } else {
    for (let i = 0; i < 5; i += 1) {
      accessKey = generateAccessKey(12);
      const { data: newKey, error } = await admin
        .from("access_keys")
        .insert({
          brand_id: brandId,
          key: accessKey,
          label: `${normalizedName} | ${link.package_name}`,
          expired_at: expiresAt,
          is_active: true,
          subscriber_id: subscriberId,
        })
        .select("id")
        .single();
      if (!error) {
        keyErrorMsg = "";
        accessKeyId = newKey.id;
        break;
      }
      keyErrorMsg = error.message;
    }
  }

  if (keyErrorMsg) return internalError(keyErrorMsg);

  const { error: redemptionInsertError } = await admin.from("link_redemptions").insert({
    brand_id: brandId,
    package_link_id: link.id,
    subscriber_id: subscriberId,
    access_key_id: accessKeyId || null,
    email_normalized: normalizedEmail,
    phone_normalized: normalizedPhone,
    metadata: {
      package_name: link.package_name,
      duration_days: durationDays,
    },
  });
  if (redemptionInsertError) {
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

  const currentClicks = Number(link.click_count ?? 0);
  const currentRedemptions = Number(link.redemptions_count ?? 0);
  await admin
    .from("package_links")
    .update({
      click_count: (Number.isFinite(currentClicks) ? currentClicks : 0) + 1,
      redemptions_count: (Number.isFinite(currentRedemptions) ? currentRedemptions : 0) + 1,
      last_clicked_at: new Date().toISOString(),
    })
    .eq("brand_id", brandId)
    .eq("id", link.id);

  await sendTelegramRegisterAlert({
    admin,
    brandId,
    name: normalizedName,
    email: normalizedEmail,
    phone: normalizedPhone,
    packageName: link.package_name,
    durationDays,
    accessKey,
    expiredAt: expiresAt,
    linkToken: token,
    isExistingSubscriber,
  });

  return NextResponse.json({
    ok: true,
    access_key: accessKey,
    expired_at: expiresAt,
    package_name: link.package_name,
    duration_days: durationDays,
  });
}
