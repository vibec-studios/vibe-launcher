// Startansicht der Social-Seite (kein Chat gewählt): Einladungen, Freunde, die gerade hosten,
// Pack per Code öffnen, eigene geteilte Packs, Hosting-Limits.
import { useQuery } from "@tanstack/react-query";
import { copyText as writeText } from "@/components/content/util";
import { Copy, Mail, PackageOpen, Play, Radio, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, IconButton, Input, Skeleton, Tooltip, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { useVibe } from "@/lib/vibe";
import type { Invite } from "@/lib/vibe-sdk";
import { Avatar, FriendRow } from "./FriendsList";
import { useFriends } from "./hooks";
import { openInviteAccept, openPackImport, PackIcon } from "./dialogs";
import { errText, removeInviteLocal, requireClient, useSocial, vqk } from "./service";

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-line bg-surface/60">
      <header className="flex h-10 items-center justify-between border-b border-line px-4">
        <span className="eyebrow">{title}</span>
        {right}
      </header>
      <div>{children}</div>
    </section>
  );
}

function InviteRow({ inv }: { inv: Invite }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Avatar user={inv.from} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-white">{inv.target.name}</div>
        <div className="truncate text-[12px] text-muted">
          {t("social.accept.from", { name: inv.from.name })}
          {inv.target.mcVersion ? ` · ${inv.target.mcVersion}` : ""}
          {inv.message ? ` · „${inv.message}“` : ""}
        </div>
      </div>
      <Button
        size="sm"
        variant="subtle"
        onClick={async () => {
          try {
            await requireClient().invites.decline(inv.id);
            removeInviteLocal(inv.id);
          } catch (e) {
            toast.error(errText(e));
          }
        }}
      >
        {t("social.invite.decline")}
      </Button>
      <Button size="sm" variant="primary" onClick={() => openInviteAccept({ invite: inv })}>
        {t("social.invite.accept")}
      </Button>
    </div>
  );
}

function PackCode() {
  const t = useT();
  const [code, setCode] = useState("");
  const parse = (v: string) => {
    const m = v.trim().match(/(?:\/p\/|pack\/)?([A-Za-z0-9]{4,16})\/?$/);
    return m ? m[1].toUpperCase() : "";
  };
  const c = parse(code);
  return (
    <form
      className="flex gap-2 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (c) openPackImport(c);
      }}
    >
      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("social.pack.code_ph")} className="font-mono text-[12px]" spellCheck={false} />
      <Button type="submit" icon={<PackageOpen size={14} />} disabled={!c}>
        {t("social.pack.open")}
      </Button>
    </form>
  );
}

function MyPacks() {
  const t = useT();
  const q = useQuery({ queryKey: vqk.packsMine, queryFn: () => requireClient().packs.mine(), staleTime: 60_000 });
  if (q.isLoading) return <Skeleton className="m-4 h-10" />;
  if (q.isError) return <p className="px-4 pb-4 text-[12px] text-danger">{errText(q.error)}</p>;
  if (!q.data?.length) return <p className="px-4 pb-4 text-[12px] text-dim">{t("social.pack.none")}</p>;
  return (
    <div className="border-t border-line">
      {q.data.map((p) => (
        <div key={p.id} className="flex items-center gap-3 px-4 py-2">
          <PackIcon pack={p} size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white">{p.name}</div>
            <div className="truncate font-mono text-[11px] text-dim">
              {p.code} · {t(`social.share.vis.${p.visibility}`)} · {t("social.pack.downloads", { n: p.downloads })}
            </div>
          </div>
          <Tooltip content={t("social.share.copy_link")}>
            <IconButton label={t("social.share.copy_link")} size="sm" onClick={() => writeText(p.url).then(() => toast.success(t("social.copied"), p.url))}>
              <Copy size={14} />
            </IconButton>
          </Tooltip>
          <Tooltip content={t("social.pack.delete")}>
            <IconButton
              label={t("social.pack.delete")}
              size="sm"
              onClick={async () => {
                if (!(await confirm({ title: t("social.pack.delete_q", { name: p.name }), confirmLabel: t("social.pack.delete"), danger: true }))) return;
                try {
                  await requireClient().packs.delete(p.code);
                  q.refetch();
                } catch (e) {
                  toast.error(errText(e));
                }
              }}
            >
              <Trash2 size={14} />
            </IconButton>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}

function HostingLimits() {
  const t = useT();
  const q = useQuery({ queryKey: vqk.hostingLimits, queryFn: () => requireClient().hosting.limits(), staleTime: 30_000 });
  if (!q.data) return <Skeleton className="m-4 h-5 w-48" />;
  const l = q.data;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-[12px] text-muted">
      {!l.enabled && <span className="text-warn">{t("social.hosting.disabled")}</span>}
      <span>{t("social.hosting.limits", { active: l.active, max: l.maxHosts })}</span>
      <span>{l.maxPlayersPerHost ? t("social.hosting.players", { n: l.maxPlayersPerHost }) : t("social.hosting.players_any")}</span>
    </div>
  );
}

export function Overview() {
  const t = useT();
  const vibe = useVibe();
  const invites = useSocial((s) => s.invites);
  const hosts = useSocial((s) => s.hosts);
  const motd = useSocial((s) => s.motd);
  const me = useSocial((s) => s.me);
  const friends = useFriends();
  const playing = friends.filter((f) => f.presence.status !== "offline").slice(0, 8);
  const hostList = Object.values(hosts).filter((h) => h.status === "online" && h.address);
  return (
    <div className="scroll h-full">
      <div className="mx-auto flex max-w-[880px] flex-col gap-4 p-6">
        <div>
          <h1 className="display text-[22px] text-white">{t("social.title")}</h1>
          <p className="mt-1 text-[13px] text-muted">{me ? t("social.signed_in_as", { name: me.name }) : ""}</p>
        </div>
        {motd && <div className="border border-warn/40 bg-warn/10 px-4 py-2.5 text-[13px] text-warn">{motd}</div>}

        {invites.length > 0 && (
          <Card title={t("social.invites.title", { n: invites.length })} right={<Mail size={14} className="text-brand" />}>
            {invites.map((inv) => (
              <InviteRow key={inv.id} inv={inv} />
            ))}
          </Card>
        )}

        {hostList.length > 0 && (
          <Card title={t("social.hosts.title")} right={<Radio size={14} className="text-ok" />}>
            {hostList.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar user={h.host} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-white">{t("social.hosts.hosting", { name: h.host.name })}</div>
                  <div className="truncate text-[12px] text-muted">
                    {h.mcVersion ?? "?"} · {t("social.hosts.players", { n: h.players.length })}
                  </div>
                </div>
                <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => openInviteAccept({ host: h })}>
                  {t("social.accept.join")}
                </Button>
              </div>
            ))}
          </Card>
        )}

        <Card title={t("social.friends.online", { n: playing.length })}>
          {playing.length === 0 ? (
            <p className="px-4 py-3 text-[12px] text-dim">{friends.length ? t("social.friends.none_online") : t("social.friends.empty_long")}</p>
          ) : (
            <div className="grid grid-cols-2 py-1">
              {playing.map((f) => (
                <FriendRow key={f.user.id} friend={f} />
              ))}
            </div>
          )}
        </Card>

        {vibe.sharing && (
          <Card title={t("social.pack.title")}>
            <PackCode />
            <MyPacks />
          </Card>
        )}

        {vibe.hosting && (
          <Card title={t("social.hosting.title")}>
            <HostingLimits />
          </Card>
        )}
      </div>
    </div>
  );
}
