export function isAdminAuthorized(req: Request) {
  const single = process.env.ADMIN_CRM_KEY ?? "";
  const multi = process.env.ADMIN_CRM_KEYS ?? "";
  const received = req.headers.get("x-admin-key") ?? "";
  const allowList = [
    ...multi.split(",").map((k) => k.trim()).filter(Boolean),
    single.trim(),
  ].filter(Boolean);

  if (allowList.length === 0) return false;
  return allowList.includes(received.trim());
}
