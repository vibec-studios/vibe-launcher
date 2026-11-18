// Rechte Spalte der Startseite: Vibe-Nachricht, Freunde (online/hostend) und „Neu für deine Instanzen“.
import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpCircle, CheckCircle2, ChevronRight, Megaphone, Play } from "lucide-react";
import type { Instance } from "@/lib/types";
import type { Friend, HostSession } from "@/lib/vibe-sdk";
import { instanceAccent } from "@/lib/format";
import { Button, cn } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { useModpackUpdate } from "@/features/content/ModpackUpdate";
import { useVibe } from "@/lib/vibe";
import { useSocial } from "@/features/social/service";
import { useFriends, useOnline } from "@/features/social/hooks";
import { Avatar, startDm } from "@/features/social/FriendsList";
import { usePresenceText } from "@/features/social/presence";
import { openInviteAccept } from "@/features/social/dialogs";
import { useT } from "@/i18n";
import { useUpdateCounts } from "./data";
import { MoreLink, SectionHead } from "./Recent";

// ------------------------------------------------------------------ Vibe-Nachricht

export function VibeNews() {
  const t = useT();
  const vibe = useVibe();
  const motd = useSocial((s) => s.motd);
  if (!vibe.enabled || !motd) return null;
  return (
    <section className="flex gap-3 rounded-panel bg-surface p-4">
      <Megaphone size={16} className="mt-0.5 shrink-0 text-brand" />
      <div className="min-w-0">
        <div className="text-section text-text">{t("home.news")}</div>
        <p className="selectable mt-0.5 text-meta text-muted">{motd}</p>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Freunde

function FriendLine({ friend, host }: { friend: Friend; host?: HostSession }) {
  const t = useT();
  const ptext = usePresenceText();
  const a = friend.presence.activity;
  const active = a?.type === "playing" || a?.type === "hosting";
  return (
    <div className="group flex h-12 min-w-0 items-center gap-2.5 px-3 transition-colors duration-100 hover:bg-white/[.03]">
      <button onClick={() => void startDm(friend.user.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <Avatar user={friend.user} size={28} presence={friend.presence} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-tight text-text">{friend.user.name}</span>
          <span className={cn("block truncate text-[12px] leading-tight", active ? "text-brand" : "text-muted")}>{ptext(friend.presence)}</span>
        </span>
      </button>
      {host && (
        <Button size="sm" variant="ghost" icon={<Play size={12} fill="currentColor" />} onClick={() => openInviteAccept({ host })}>
          {t("home.friends.join")}
        </Button>
      )}
    </div>
  );
}

/** Nur mit Vibe (Freunde an) und verbundener Sitzung; ausgeblendet, solange das Freunde-Panel rechts offen ist. */
export function FriendsBlock() {
  const t = useT();
  const vibe = useVibe();
  const online = useOnline();
  const panelOpen = useSocial((s) => s.panelOpen);
  const hosts = useSocial((s) => s.hosts);
  const friends = useFriends();
  const on = useMemo(() => friends.filter((f) => f.presence.status !== "offline"), [friends]);
  const hostOf = (f: Friend) => Object.values(hosts).find((h) => h.host.id === f.user.id && h.status === "online");
  if (!vibe.social || !online || panelOpen || !friends.length) return null;
  // Hostende zuerst (dort kann man sofort mitspielen), dann Spielende, dann Rest (useFriends sortiert schon)
  const list = on
    .slice()
    .sort((a, b) => Number(!!hostOf(b)) - Number(!!hostOf(a)))
    .slice(0, 6);
  return (
    <section>
      <SectionHead
        title={t("home.friends")}
        count={t("home.friends.online", { n: on.length })}
        link={<MoreLink to="/social">{t("home.friends.all")}</MoreLink>}
      />
      <div className="overflow-hidden rounded-panel bg-surface">
        {list.length ? (
          <div className="py-1">
            {list.map((f) => (
              <FriendLine key={f.user.id} friend={f} host={hostOf(f)} />
            ))}
          </div>
        ) : (
          <p className="px-4 py-3.5 text-meta text-dim">{t("home.friends.none")}</p>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Neu für deine Instanzen

function UpdateLine({ instance: i, mods }: { instance: Instance; mods: number }) {
  const t = useT();
  const nav = useNavigate();
  const pack = useModpackUpdate(i);
  if (!pack.data && !mods) return null;
  const lines = [
    pack.data ? t("home.new.pack", { v: pack.data.latest.version_number }) : null,
    mods ? (mods === 1 ? t("home.new.mods_1") : t("home.new.mods_n", { n: mods })) : null,
  ].filter(Boolean);
  return (
    <button
      onClick={() => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "content" } })}
      className="group flex min-h-12 w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left transition-colors duration-100 hover:bg-white/[.03]"
    >
      <InstanceIcon icon={i.icon} accent={instanceAccent(i.id, i.accent)} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight text-text">{i.name}</span>
        {lines.map((l) => (
          <span key={l} className="flex min-w-0 items-center gap-1 truncate text-[12px] leading-snug text-brand">
            <ArrowUpCircle size={11} className="shrink-0" />
            <span className="truncate">{l}</span>
          </span>
        ))}
      </span>
      <ChevronRight size={15} className="shrink-0 text-dim transition-colors duration-100 group-hover:text-text" />
    </button>
  );
}

/** Modpack-Instanzen werden einzeln geprüft (gecacht), Inhalts-Updates kommen gesammelt aus dem Backend. */
export function UpdatesBlock({ instances }: { instances: Instance[] }) {
  const t = useT();
  const counts = useUpdateCounts();
  const candidates = useMemo(
    () => instances.filter((i) => i.install_state === "installed" && ((counts.data?.[i.id] ?? 0) > 0 || !!i.source?.project_id)),
    [instances, counts.data],
  );
  if (!instances.length) return null;
  return (
    <section>
      <SectionHead title={t("home.new")} />
      <div className="overflow-hidden rounded-panel bg-surface">
        <div className="py-1 empty:hidden [&:not(:empty)+*]:hidden">
          {candidates.map((i) => (
            <UpdateLine key={i.id} instance={i} mods={counts.data?.[i.id] ?? 0} />
          ))}
        </div>
        {/* „Alles aktuell“ nur, wenn keine Zeile darüber etwas zeigt (Modpack-Prüfung läuft je Zeile) */}
        <div className="flex items-start gap-2.5 px-4 py-3.5">
          <CheckCircle2 size={16} className="mt-px shrink-0 text-ok" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-text">{t("home.new.none")}</div>
            <div className="text-[12px] text-muted">{t("home.new.none_text")}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
