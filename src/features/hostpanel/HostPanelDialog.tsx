import { useState } from "react";
import { Ban, Copy, Globe, Lock, ShieldCheck, Users } from "lucide-react";
import { Button, Dialog, Skeleton, Tabs, cn } from "@/components/ui";
import { copyText } from "@/components/content/util";
import { useT } from "@/i18n";
import { hostError, useHostPanel } from "./api";
import { EventLog } from "./EventLog";
import { BansSection, ListSection, PlayersSection, PrivacySection, RoleTag } from "./Sections";

type Tab = "players" | "list" | "bans" | "privacy";

export function HostPanelDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const t = useT();
  const q = useHostPanel(sessionId);
  const [tab, setTab] = useState<Tab>("players");
  const p = q.data;
  const s = p?.session;
  const ended = s?.status === "ended";
  const title = s ? (s.worldName ?? (s.kind === "server" ? t("hpanel.server") : t("hpanel.world"))) : t("hpanel.title");
  const privacyIcon = p?.policy.privacy === "invite" ? <Lock size={12} /> : p?.policy.privacy === "friends" ? <Users size={12} /> : <Globe size={12} />;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="full"
      title={t("hpanel.title_world", { name: title })}
      description={t("hpanel.desc")}
      footer={
        <Button variant="subtle" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      {q.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-64" />
        </div>
      ) : q.isError || !p || !s ? (
        <p className="text-[13px] text-danger">{hostError(q.error)}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card bg-surface px-4 py-3">
            <span className={cn("h-2 w-2 shrink-0 rounded-dot", ended ? "bg-dim" : "bg-ok")} />
            <span className="text-[13px] font-semibold text-text">{ended ? t("hpanel.ended") : t("hpanel.online")}</span>
            {s.address && (
              <button className="flex min-w-0 items-center gap-1.5 font-mono text-caption text-muted hover:text-text" onClick={() => void copyText(s.address!)} title={t("hpanel.copy_address")}>
                <span className="truncate">{s.address}</span>
                <Copy size={11} />
              </button>
            )}
            <span className="flex items-center gap-1.5 text-caption text-muted">
              {privacyIcon}
              {t(`hpanel.privacy.${p.policy.privacy}`)}
            </span>
            <span className="text-caption tabular-nums text-muted">{t("hpanel.count", { n: p.players.length + 1 })}</span>
            {s.pack && <span className="text-caption text-muted">{t("hpanel.pack", { name: s.pack.name })}</span>}
            <span className="ml-auto flex items-center gap-2 text-caption text-dim">
              {t("hpanel.you_are")}
              <RoleTag role={p.myRole} />
            </span>
          </div>
          <div className="grid min-h-0 grid-cols-1 gap-6 min-[1000px]:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-4">
              <Tabs
                value={tab}
                onChange={setTab}
                items={[
                  { value: "players", label: t("hpanel.tab.players"), icon: <Users size={14} />, badge: p.players.length || undefined },
                  { value: "list", label: t("hpanel.tab.list"), icon: <ShieldCheck size={14} />, badge: p.members.length || undefined },
                  { value: "bans", label: t("hpanel.tab.bans"), icon: <Ban size={14} />, badge: p.kicks.length || undefined },
                  { value: "privacy", label: t("hpanel.tab.privacy"), icon: <Lock size={14} /> },
                ]}
              />
              {tab === "players" && <PlayersSection panel={p} />}
              {tab === "list" && <ListSection panel={p} />}
              {tab === "bans" && <BansSection panel={p} />}
              {tab === "privacy" && <PrivacySection panel={p} />}
            </div>
            <EventLog sessionId={sessionId} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
