import { Globe, Lock, Server, Settings2, Users } from "lucide-react";
import type { HostSession } from "@/lib/vibe-sdk";
import { Button } from "@/components/ui";
import { useVibe } from "@/lib/vibe";
import { useT } from "@/i18n";
import { openHostPanel, useMyHosts } from "./api";

function HostRow({ h }: { h: HostSession }) {
  const t = useT();
  const privacy = h.privacy ?? "public";
  const icon = privacy === "invite" ? <Lock size={12} /> : privacy === "friends" ? <Users size={12} /> : <Globe size={12} />;
  return (
    <div className="flex items-center gap-3 rounded-card bg-surface px-4 py-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl bg-brand/15 text-brand">{h.kind === "server" ? <Server size={17} /> : <Globe size={17} />}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-text">{h.worldName ?? (h.kind === "server" ? t("hpanel.server") : t("hpanel.world"))}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-caption text-muted">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-dot bg-ok" />
            {t("hpanel.count", { n: h.players.length + 1 })}
          </span>
          <span className="flex items-center gap-1">
            {icon}
            {t(`hpanel.privacy.${privacy}`)}
          </span>
          {h.pack && <span className="truncate">{t("hpanel.pack", { name: h.pack.name })}</span>}
        </div>
      </div>
      <Button size="sm" variant="primary" icon={<Settings2 size={13} />} onClick={() => openHostPanel(h.id)}>
        {t("hpanel.manage")}
      </Button>
    </div>
  );
}

export function MyHostsSection() {
  const t = useT();
  const vibe = useVibe();
  const q = useMyHosts();
  const list = (q.data ?? []).filter((h) => h.status === "online");
  if (!vibe.hosting || !list.length) return null;
  return (
    <section>
      <h2 className="mb-2.5 text-[15px] font-bold tracking-[-0.01em] text-text">{t("hpanel.mine.title")}</h2>
      <div className="flex flex-col gap-2">
        {list.map((h) => (
          <HostRow key={h.id} h={h} />
        ))}
      </div>
    </section>
  );
}

export function useOwnHostFor(world: string | null | undefined): HostSession | null {
  const q = useMyHosts();
  const list = (q.data ?? []).filter((h) => h.status === "online" && h.kind === "world");
  if (!list.length) return null;
  return (world ? list.find((h) => h.worldName === world) : null) ?? list[0];
}
