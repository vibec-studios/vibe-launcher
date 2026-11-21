import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queries";
import { VibeError, type AccessInvite, type AccessInviteQuota } from "@/lib/vibe-sdk";
import { t } from "@/i18n";
import { errText, requireClient, useSocial, vibeClient } from "@/features/social/service";
import { useVibeAccess } from "@/features/access/store";

export const aik = {
  quota: ["vibe", "access-invites"] as const,
  preview: (code: string) => ["vibe", "access-invite", code] as const,
};

export const INVITE_CODE = /^[2-9a-hjkmnp-z]{8}$/;
export const MC_NAME = /^[A-Za-z0-9_]{3,16}$/;

export function normalizeCode(raw: string): string {
  const s = raw.trim();
  const m = s.match(/(?:\/i\/|invite\/)([A-Za-z0-9]{8})\/?$/);
  return (m ? m[1] : s).toLowerCase();
}

export function useInviteQuota(enabled = true) {
  const ready = useSocial((s) => s.conn === "ready");
  const approved = useVibeAccess((s) => s.status === "approved");
  return useQuery({
    queryKey: aik.quota,
    queryFn: () => requireClient().accessInvites.list(),
    enabled: enabled && ready && approved && !!vibeClient(),
    staleTime: 30_000,
    retry: 0,
  });
}

export async function createInvite(name?: string): Promise<AccessInvite> {
  const inv = await requireClient().accessInvites.create(name ? { name } : {});
  queryClient.setQueryData<AccessInviteQuota>(aik.quota, (q) =>
    q ? { ...q, used: q.used + 1, remaining: Math.max(0, q.remaining - 1), invites: [inv, ...q.invites.filter((x) => x.id !== inv.id)] } : q,
  );
  void queryClient.invalidateQueries({ queryKey: aik.quota });
  return inv;
}

export async function revokeInvite(id: string) {
  await requireClient().accessInvites.revoke(id);
  queryClient.setQueryData<AccessInviteQuota>(aik.quota, (q) =>
    q ? { ...q, used: Math.max(0, q.used - 1), remaining: q.remaining + 1, invites: q.invites.map((x) => (x.id === id ? { ...x, status: "revoked" as const } : x)) } : q,
  );
  void queryClient.invalidateQueries({ queryKey: aik.quota });
}

export function inviteError(e: unknown): string {
  if (e instanceof VibeError) {
    if (e.code === "limit_reached") return t("ainv.err.limit");
    if (e.code === "feature_disabled") return t("ainv.err.disabled");
    if (e.code === "conflict") return t("ainv.err.conflict");
    if (e.code === "gone" || e.status === 410) return t("ainv.err.gone");
    if (e.status === 404) return t("ainv.err.not_found");
    if (e.code === "forbidden") return t("ainv.err.other_name");
  }
  return errText(e);
}

export function redeemError(e: unknown): string {
  if (e instanceof VibeError && e.status === 409) return t("ainv.err.rejected");
  return inviteError(e);
}
