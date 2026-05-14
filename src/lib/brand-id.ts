const DEFAULT_BRAND_ID = "shinobi";

export function resolveBrandId(req?: Request): string {
  const fromEnv = (process.env.BRAND_ID ?? process.env.NEXT_PUBLIC_BRAND_ID ?? "").trim().toLowerCase();
  if (fromEnv) return fromEnv;

  const host = req
    ? (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").trim().toLowerCase()
    : "";

  if (host.includes("kafra")) return "kafra";
  if (host.includes("sarjan")) return "sarjan";
  if (host.includes("richjoker")) return "richjoker";
  if (host.includes("shinobi")) return "shinobi";

  return DEFAULT_BRAND_ID;
}
