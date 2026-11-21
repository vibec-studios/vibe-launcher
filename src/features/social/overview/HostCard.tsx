import { Play, Radio } from "lucide-react";
import { Button, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import type { Friend, HostSession } from "@/lib/vibe-sdk";
import { Avatar } from "../FriendsList";
import { loaderName, since } from "../presence";
import { openInviteAccept } from "../dialogStore";
import { useSocial } from "../service";

// ------------------------------------------------------------------ Hosts von Freunden (prominent)

export function HostCard({ h, friend }: { h: HostSession; friend: Friend | undefined }) {
  const t = useT();
  const friends = useSocial((s) => s.friends);
  const me = useSocial((s) => s.me);
  // Mitspieler als bekannte Nutzer (Skin), sonst Kopf über die UUID
  const userOf = (p: HostSession["players"][number]) => (p.uuid && (friends[p.uuid]?.user ?? (me?.id === p.uuid ? me : null))) || { id: p.uuid ?? p.name, name: p.name };
  const a = friend?.presence.activity;
  const title = a?.world ?? a?.instanceName ?? t("social.hosts.world_of", { name: h.host.name });
  const meta = [h.mcVersion ?? a?.mcVersion, a?.loader && a.loader !== "vanilla" ? loaderName(a.loader) : null].filter(Boolean).join(" · ");
  const up = since(h.onlineAt ?? h.startedAt, t);
  return (
    <div className="group flex flex-col gap-3 rounded-card bg-surface p-4 transition-colors duration-150 hover:bg-surface2">
      <div className="flex items-start gap-3">
        <Avatar user={h.host} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-brand">
            <Radio size={12} strokeWidth={2.4} />
            {t("social.hosts.hosting", { name: h.host.name })}
          </div>
          <div className="mt-0.5 truncate text-[16px] font-bold leading-tight tracking-[-0.01em] text-text">{title}</div>
          <div className="mt-0.5 truncate text-[12px] text-dim">{[meta, up ? t("social.hosts.up", { time: up }) : null].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex items-center -space-x-1">
            {h.players.slice(0, 6).map((p) => (
              <Tooltip key={p.name} content={p.name}>
                <span className="rounded-xs ring-2 ring-[var(--surface-1)] transition-[box-shadow] group-hover:ring-[var(--surface-2)]">
                  <Avatar user={userOf(p)} size={22} />
                </span>
              </Tooltip>
            ))}
          </div>
          <span className="truncate text-[12px] tabular-nums text-muted">
            {h.maxPlayers ? t("social.hosts.players_of", { n: h.players.length, max: h.maxPlayers }) : t("social.hosts.players", { n: h.players.length })}
          </span>
        </div>
        <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => openInviteAccept({ host: h })}>
          {t("social.accept.join")}
        </Button>
      </div>
    </div>
  );
}
