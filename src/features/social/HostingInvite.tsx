// „Freunde einladen“ + Hosting-Limits im Verbindungs-Tab eines lokalen Servers (Relay/playit).
import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n";
import { useVibe } from "@/lib/vibe";
import { AccessStrip } from "@/features/access/AccessStrip";
import { openInviteFriends } from "./dialogs";
import { login, requireClient, useSocial, vqk } from "./service";

export function HostingInvite({ serverId, relay }: { serverId: string; relay: boolean }) {
  const t = useT();
  const vibe = useVibe();
  const conn = useSocial((s) => s.conn);
  const ready = conn === "ready";
  const limits = useQuery({ queryKey: vqk.hostingLimits, queryFn: () => requireClient().hosting.limits(), enabled: ready && relay && vibe.hosting, staleTime: 30_000 });
  if (!vibe.social) return null;
  if (conn === "no_access") return <AccessStrip className="mt-3 bg-surface2" />;
  return (
    <div className="flex flex-wrap items-center gap-3 pt-3">
      <p className="min-w-0 flex-1 text-[12px] text-dim">
        {conn === "logged_out" ? t("social.hosting.login_hint") : t("social.hosting.invite_hint")}
        {limits.data && (
          <span className="mt-0.5 block text-caption tabular-nums">
            {t("social.hosting.limits", { active: limits.data.active, max: limits.data.maxHosts })}
            {limits.data.maxPlayersPerHost ? ` · ${t("social.hosting.players", { n: limits.data.maxPlayersPerHost })}` : ""}
          </span>
        )}
      </p>
      {conn === "logged_out" ? (
        <Button size="sm" onClick={() => login().catch(() => {})}>
          {t("social.conn.login")}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" icon={<Mail size={13} />}
 disabled={!ready} onClick={() => openInviteFriends({ serverId })}>
          {t("social.invite.friends_button")}
        </Button>
      )}
    </div>
  );
}
