import { useAccounts } from "@/lib/queries";
import { useT } from "@/i18n";
import { accessCache } from "./cache";
import { isBlocked, useVibeAccess } from "./store";

export function useAccessBlocked() {
  return useVibeAccess((s) => isBlocked(s.status));
}

export function useAccessLine(): string | null {
  const t = useT();
  const status = useVibeAccess((s) => s.status);
  const info = useVibeAccess((s) => s.info);
  if (status === "none") return t("access.inline.none");
  if (status === "rejected") return t("access.inline.rejected");
  if (status !== "waitlist") return null;
  return info?.position && info.total ? t("access.inline.waitlist", { pos: info.position, total: info.total }) : t("access.inline.waitlist_nopos");
}

export function useKnownApproved() {
  const status = useVibeAccess((s) => s.status);
  const { data: accounts } = useAccounts();
  const active = accounts?.find((a) => a.active) ?? accounts?.[0];
  return status === "approved" || (!!active && accessCache.approved(active.id));
}
