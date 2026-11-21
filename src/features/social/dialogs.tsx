// Dialoge der Vibe-Dienste (global eingebunden über <SocialDialogs/>):
// Freunde einladen (gehosteter Server), Einladung annehmen (Instanz finden/installieren + direkt joinen),
// Instanz als Pack teilen, Pack per Code importieren, Gruppen anlegen/umbenennen/Mitglieder hinzufügen.
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { copyText as writeText } from "@/components/content/util";
import { Check, Copy, Link2, PackageOpen, Server as ServerIcon, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { sqk, useServers, useServerStore, waitForTask, useJavaInstances } from "@/lib/queries";
import type { Instance, LoaderKind, Server } from "@/lib/types";
import { useVibe } from "@/lib/vibe";
import type { HostSession, Invite, Pack, PackVisibility } from "@/lib/vibe-sdk";
import { Button, Checkbox, Dialog, Field, Input, Segmented, Select, Skeleton, Spinner, Textarea, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { useInstanceActions } from "@/components/instance/actions";
import { finishNewInstance } from "@/components/content/install";
import { instanceAccent } from "@/lib/format";
import { t as tr, useT } from "@/i18n";
import { Avatar } from "./FriendsList";
import { useFriends } from "./hooks";
import { GateState } from "./Gate";
import { errText, openSocial, removeInviteLocal, requireClient, useSocial, vibeClient, vqk } from "./service";
import { openPackImport, useSocialDialogs, type AcceptReq, type DialogState } from "./dialogStore";

export function SocialDialogs() {
  const d = useSocialDialogs();
  const close = (k: keyof DialogState) => () => useSocialDialogs.setState({ [k]: k === "newGroup" ? false : null } as Partial<DialogState>);
  return (
    <>
      {d.inviteFriends && <InviteFriendsDialog init={d.inviteFriends} onClose={close("inviteFriends")} />}
      {d.accept && <AcceptDialog req={d.accept} onClose={close("accept")} />}
      {d.share && <ShareDialog instanceId={d.share.instanceId} onClose={close("share")} />}
      {d.pack && <PackImportDialog code={d.pack.code} onClose={close("pack")} />}
      {d.newGroup && <GroupDialog onClose={close("newGroup")} />}
      {d.addMembers && <GroupDialog chatId={d.addMembers} onClose={close("addMembers")} />}
      {d.rename && <RenameDialog {...d.rename} onClose={close("rename")} />}
    </>
  );
}

function NeedLogin({ title, onClose }: { title: string; onClose: () => void }) {
  const conn = useSocial((s) => s.conn);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} size="sm">
      <GateState conn={conn} compact />
    </Dialog>
  );
}

function useReady() {
  return useSocial((s) => s.conn === "ready" || ((s.conn === "reconnecting" || s.conn === "offline") && !!s.me));
}

// ------------------------------------------------------------------ Freunde einladen

type Hosted = { server: Server; address: string; kind: "relay" | "playit" | "direct" };

/** Eigene laufende Server: über Relay/playit erreichbar oder lokal (LAN-Adresse, nur im selben Netzwerk). */
function useHostedServers(): Hosted[] {
  const { data: servers = [] } = useServers();
  const statuses = useServerStore((s) => s.statuses);
  const running = servers.filter((s) => statuses[s.id]?.state === "running");
  const local = running.filter((s) => s.connection === "local");
  const addrs = useQueries({
    queries: local.map((s) => ({ queryKey: sqk.addresses(s.id), queryFn: () => api.serverAddresses(s.id), staleTime: 60_000 })),
  });
  const lan = local.map((s, i) => ({ s, a: addrs[i]?.data?.lan[0] ?? null }));
  const lanKey = lan.map((x) => `${x.s.id}=${x.a}`).join(",");
  return useMemo(() => {
    const out: Hosted[] = [];
    for (const server of servers) {
      const st = statuses[server.id];
      if (st?.state !== "running") continue;
      const tun = st.tunnel;
      if (tun?.address && (tun.kind === "relay" || tun.kind === "playit") && tun.state !== "error") out.push({ server, address: tun.address, kind: tun.kind });
      else if (server.connection === "local") {
        const a = lan.find((x) => x.s.id === server.id)?.a;
        if (a) out.push({ server, address: a, kind: "direct" });
      }
    }
    return out;
  }, [servers, statuses, lanKey]); // eslint-disable-line react-hooks/exhaustive-deps
}

function InviteFriendsDialog({ init, onClose }: { init: NonNullable<DialogState["inviteFriends"]>; onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const vibe = useVibe();
  const ready = useReady();
  const hosted = useHostedServers();
  const friends = useFriends();
  const [serverId, setServerId] = useState<string | null>(init.serverId ?? null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(init.userIds ?? []));
  const [message, setMessage] = useState("");
  const [packCode, setPackCode] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const target = hosted.find((h) => h.server.id === serverId) ?? hosted[0];
  const limits = useQuery({ queryKey: vqk.hostingLimits, queryFn: () => requireClient().hosting.limits(), enabled: ready && vibe.hosting, staleTime: 30_000 });
  const packs = useQuery({ queryKey: vqk.packsMine, queryFn: () => requireClient().packs.mine(), enabled: ready && vibe.sharing, staleTime: 60_000 });

  if (!ready) return <NeedLogin title={t("social.invite.title")} onClose={onClose} />;

  const send = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const c = requireClient();
      let hostSessionId: string | undefined;
      if (target.kind === "relay") {
        const mine = await c.hosting.mine().catch(() => [] as HostSession[]);
        const addr = target.address.split(":")[0].toLowerCase();
        hostSessionId = mine.find((h) => h.status !== "ended" && h.address && h.address.split(":")[0].toLowerCase() === addr)?.id;
      }
      const [host, portStr] = target.address.split(":");
      const port = portStr ? Number(portStr) : undefined;
      await c.invites.send({
        kind: "server",
        toUserIds: init.chatId ? undefined : [...picked],
        chatId: init.chatId,
        target: {
          name: target.server.name.slice(0, 100),
          mcVersion: target.server.mc_version,
          loader: target.server.loader.kind,
          packCode: packCode || null,
        },
        message: message.trim() || undefined,
        hostSessionId,
        connection: hostSessionId ? undefined : { type: target.kind, address: host, port: port && port !== 25565 ? port : undefined },
      });
      toast.success(t("social.invite.sent"));
      onClose();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const canSend = !!target && (init.chatId || picked.size > 0);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("social.invite.title")}
      description={t("social.invite.desc")}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={send} loading={busy} disabled={!canSend}>
            {t("social.invite.send")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!vibe.hosting ? (
          <p className="text-[13px] text-muted">{t("social.invite.hosting_off")}</p>
        ) : hosted.length === 0 ? (
          <div className="rounded-card bg-surface p-3 text-[13px] text-muted">
            <p>{t("social.invite.no_server")}</p>
            <Button
              size="sm"
              className="mt-3"
              icon={<ServerIcon size={14} />}
              onClick={() => {
                onClose();
                nav({ to: "/servers" });
              }}
            >
              {t("nav.servers")}
            </Button>
          </div>
        ) : (
          <Field label={t("social.invite.server")}>
            <Select
              value={target?.server.id ?? null}
              onChange={setServerId}
              options={hosted.map((h) => ({ value: h.server.id, label: h.server.name, hint: h.address }))}
            />
            {target?.kind === "direct" && <p className="mt-1.5 text-[12px] text-warn">{t("social.invite.lan_hint")}</p>}
          </Field>
        )}
        {limits.data && (
          <p className="font-mono text-[11px] text-dim">
            {t("social.hosting.limits", { active: limits.data.active, max: limits.data.maxHosts })}
            {limits.data.maxPlayersPerHost ? ` · ${t("social.hosting.players", { n: limits.data.maxPlayersPerHost })}` : ""}
          </p>
        )}
        {!init.chatId && (
          <Field label={t("social.invite.friends")}>
            <div className="scroll max-h-52 rounded-card bg-surface py-1">
              {friends.length === 0 && <p className="p-3 text-[12px] text-dim">{t("social.friends.empty")}</p>}
              {friends.map((f) => (
                <label key={f.user.id} className="flex h-9 cursor-pointer items-center gap-2.5 px-3 transition-colors duration-100 hover:bg-white/[.04]">
                  <Checkbox
                    checked={picked.has(f.user.id)}
                    onChange={(on) => {
                      const n = new Set(picked);
                      if (on) n.add(f.user.id);
                      else n.delete(f.user.id);
                      setPicked(n);
                    }}
                  />
                  <Avatar user={f.user} size={22} presence={f.presence} />
                  <span className="text-[13px] text-text">{f.user.name}</span>
                </label>
              ))}
            </div>
          </Field>
        )}
        {vibe.sharing && (packs.data?.length ?? 0) > 0 && (
          <Field label={t("social.invite.pack")} hint={t("social.invite.pack_hint")}>
            <Select
              value={packCode || "__none"}
              onChange={(v) => setPackCode(v === "__none" ? "" : v)}
              options={[{ value: "__none", label: t("social.invite.pack_none") }, ...(packs.data ?? []).map((p) => ({ value: p.code, label: p.name, hint: p.code }))]}
            />
          </Field>
        )}
        <Field label={t("social.invite.message")}>
          <Input value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} placeholder={t("social.invite.message_ph")} />
        </Field>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Einladung annehmen

interface JoinTarget {
  title: string;
  from: { id: string; name: string };
  mcVersion: string | null;
  loader: string | null;
  packCode: string | null;
  message: string | null;
  expiresAt: string | null;
  invite: Invite | null;
  host: HostSession | null;
}

function matchInstances(instances: Instance[], tgt: JoinTarget): Instance[] {
  if (tgt.packCode) {
    const fromPack = instances.filter((i) => i.source?.kind === "vibe" && i.source.project_id?.toUpperCase() === tgt.packCode!.toUpperCase());
    if (fromPack.length) return fromPack;
  }
  return instances
    .filter((i) => (!tgt.mcVersion || i.mc_version === tgt.mcVersion) && (!tgt.loader || tgt.loader === "vanilla" || i.loader.kind === tgt.loader))
    .sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0));
}

function AcceptDialog({ req, onClose }: { req: AcceptReq; onClose: () => void }) {
  const t = useT();
  const ready = useReady();
  const vibe = useVibe();
  const { data: instances = [] } = useJavaInstances();
  const { launch } = useInstanceActions();
  const stored = useSocial((s) => s.invites);
  const [tgt, setTgt] = useState<JoinTarget | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Ziel bestimmen (Einladung aus dem Store/Backend oder Host-Session eines Freundes)
  useEffect(() => {
    if (!ready) return;
    let dead = false;
    (async () => {
      try {
        if ("host" in req) {
          const h = req.host;
          setTgt({ title: h.host.name, from: h.host, mcVersion: h.mcVersion, loader: null, packCode: null, message: null, expiresAt: null, invite: null, host: h });
          return;
        }
        let inv = "invite" in req ? req.invite : stored.find((i) => i.id === req.inviteId);
        if (!inv) inv = (await requireClient().invites.list("incoming")).find((i) => i.id === (req as { inviteId: string }).inviteId);
        if (dead) return;
        if (!inv) throw new Error(tr("social.invite.not_found"));
        setTgt({
          title: inv.target.name,
          from: inv.from,
          mcVersion: inv.target.mcVersion ?? null,
          loader: inv.target.loader ?? null,
          packCode: inv.target.packCode ?? null,
          message: inv.message,
          expiresAt: inv.expiresAt,
          invite: inv,
          host: null,
        });
      } catch (e) {
        if (!dead) setLoadErr(errText(e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = useMemo(() => (tgt ? matchInstances(instances, tgt) : []), [instances, tgt]);
  const chosen = pick ?? candidates[0]?.id ?? "__new";

  if (!ready) return <NeedLogin title={t("action.invite.title")} onClose={onClose} />;

  const accept = async () => {
    if (!tgt) return;
    setErr(null);
    try {
      const c = requireClient();
      let address: string | null = null;
      let packCode = tgt.packCode;
      if (tgt.invite) {
        setStep(t("social.accept.step_accept"));
        const res = await c.invites.accept(tgt.invite.id);
        removeInviteLocal(tgt.invite.id);
        packCode = res.packCode ?? packCode;
        if (res.connection) address = res.connection.port && res.connection.port !== 25565 ? `${res.connection.address}:${res.connection.port}` : res.connection.address;
        if (!res.connection && tgt.invite.kind === "modpack" && packCode) {
          onClose();
          openPackImport(packCode);
          return;
        }
      } else if (tgt.host?.address) {
        address = tgt.host.address;
      }
      if (!address) throw new Error(t("social.accept.no_address"));

      // Instanz bestimmen / anlegen
      let inst = instances.find((i) => i.id === chosen);
      if (!inst) {
        if (packCode && vibe.sharing) {
          setStep(t("social.accept.step_pack"));
          const token = await c.accessToken().catch(() => null);
          const taskId = await api.vibePackInstall(packCode, null, token);
          const task = await waitForTask(taskId);
          if (!task.instance_id) throw new Error(t("social.accept.no_instance"));
          inst = await api.instanceGet(task.instance_id);
        } else {
          if (!tgt.mcVersion) throw new Error(t("social.accept.no_version"));
          setStep(t("social.accept.step_create"));
          const kind = (["vanilla", "fabric", "quilt", "forge", "neoforge"].includes(tgt.loader ?? "") ? tgt.loader : "vanilla") as LoaderKind;
          inst = await api.instanceCreate({ name: `${tgt.title}`.slice(0, 60), mc_version: tgt.mcVersion, loader: { kind, version: null } });
        }
      }
      setStep(t("social.accept.step_launch"));
      await launch(inst, null, address);
      toast.success(t("social.accept.joining", { name: tgt.title }), address);
      onClose();
    } catch (e) {
      setStep(null);
      if (!isCancelled(e)) setErr(errText(e) || errorMessage(e));
    }
  };

  const decline = async () => {
    if (!tgt?.invite) return onClose();
    try {
      await requireClient().invites.decline(tgt.invite.id);
      removeInviteLocal(tgt.invite.id);
    } catch (e) {
      toast.error(errText(e));
    }
    onClose();
  };

  const newLabel = tgt?.packCode ? t("social.accept.new_pack", { code: tgt.packCode }) : t("social.accept.new_instance", { version: tgt?.mcVersion ?? "?", loader: tgt?.loader ?? "vanilla" });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !step && onClose()}
      locked={!!step}
      title={tgt?.host ? t("social.accept.join_title") : t("action.invite.title")}
      size="sm"
      footer={
        <>
          {tgt?.invite ? (
            <Button variant="subtle" onClick={decline} disabled={!!step}>
              {t("social.invite.decline")}
            </Button>
          ) : (
            <Button variant="subtle" onClick={onClose} disabled={!!step}>
              {t("common.cancel")}
            </Button>
          )}
          <Button variant="primary" onClick={accept} loading={!!step} disabled={!tgt}>
            {tgt?.host ? t("social.accept.join") : t("social.invite.accept")}
          </Button>
        </>
      }
    >
      {loadErr ? (
        <p className="text-[13px] text-danger">{loadErr}</p>
      ) : !tgt ? (
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-5 w-48" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-card bg-surface p-3">
            <Avatar user={tgt.from} size={36} />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-text">{tgt.title}</div>
              <div className="truncate text-[12px] text-muted">
                {t("social.accept.from", { name: tgt.from.name })}
                {tgt.mcVersion ? ` · ${tgt.mcVersion}` : ""}
                {tgt.loader && tgt.loader !== "vanilla" ? ` · ${tgt.loader}` : ""}
              </div>
            </div>
          </div>
          {tgt.message && <p className="whitespace-pre-wrap break-words text-[13px] text-text">„{tgt.message}“</p>}
          <Field label={t("action.join.with")}>
            <Select
              value={chosen}
              onChange={setPick}
              disabled={!!step}
              options={[
                ...candidates.map((i) => ({ value: i.id, label: i.name, hint: `${i.mc_version} · ${i.loader.kind}` })),
                { value: "__new", label: newLabel },
              ]}
            />
          </Field>
          {chosen !== "__new" && (
            <InstancePreview i={instances.find((i) => i.id === chosen)} />
          )}
          {step && (
            <p className="flex items-center gap-2 text-[12px] text-muted">
              <Spinner size={11} /> {step}
            </p>
          )}
          {err && <p className="text-[12px] text-danger">{err}</p>}
        </div>
      )}
    </Dialog>
  );
}

function InstancePreview({ i }: { i: Instance | undefined }) {
  if (!i) return null;
  return (
    <div className="flex items-center gap-2.5 text-[12px] text-muted">
      <InstanceIcon icon={i.icon} seed={i.id} accent={instanceAccent(i.id, i.accent)} size={24} />
      <span className="truncate">{i.name}</span>
    </div>
  );
}

// ------------------------------------------------------------------ Teilen

function ShareDialog({ instanceId, onClose }: { instanceId: string; onClose: () => void }) {
  const t = useT();
  const ready = useReady();
  const { data: instances = [] } = useJavaInstances();
  const inst = instances.find((i) => i.id === instanceId);
  const link = useQuery({ queryKey: ["vibe", "share-link", instanceId], queryFn: () => api.vibePackLink(instanceId), staleTime: 0 });
  const [visibility, setVisibility] = useState<PackVisibility>("unlisted");
  const [description, setDescription] = useState("");
  const [newVersion, setNewVersion] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Pack | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!ready) return <NeedLogin title={t("social.share.title")} onClose={onClose} />;
  const existing = link.data?.code ?? null;
  const asVersion = !!existing && newVersion;

  const upload = async () => {
    setBusy(true);
    setErr(null);
    try {
      const token = await requireClient().accessToken();
      if (!token) throw new Error(t("social.err.not_connected"));
      const pack = (await api.vibePackShare(instanceId, token, asVersion ? { code: existing, changelog: description || null } : { visibility, description: description || null })) as Pack;
      setResult(pack);
      link.refetch();
    } catch (e) {
      if (!isCancelled(e)) setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      locked={busy}
      title={t("social.share.title")}
      description={inst?.name}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            {t("common.close")}
          </Button>
        ) : (
          <>
            <Button variant="subtle" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon={<Share2 size={14} />} onClick={upload} loading={busy}>
              {asVersion ? t("social.share.upload_version") : t("social.share.upload")}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <ShareResult pack={result} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted">{t("social.share.text")}</p>
          {existing && (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-card bg-surface p-3 text-[13px]">
              <Checkbox checked={newVersion} onChange={setNewVersion} />
              <span>
                {t("social.share.as_version")} <span className="font-mono text-brand">{existing}</span>
              </span>
            </label>
          )}
          {!asVersion && (
            <Field label={t("social.share.visibility")}>
              <Segmented
                value={visibility}
                onChange={setVisibility}
                items={[
                  { value: "unlisted", label: t("social.share.vis.unlisted") },
                  { value: "friends", label: t("social.share.vis.friends") },
                  { value: "public", label: t("social.share.vis.public") },
                ]}
              />
            </Field>
          )}
          <Field label={asVersion ? t("social.share.changelog") : t("social.share.description")}>
            <Textarea rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {busy && <p className="flex items-center gap-2 text-[12px] text-muted"><Spinner size={11} /> {t("social.share.busy")}</p>}
          {err && <p className="text-[12px] text-danger">{err}</p>}
        </div>
      )}
    </Dialog>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-[12px]" onFocus={(e) => e.target.select()} />
        <Button
          icon={done ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
          onClick={() =>
            writeText(value).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            })
          }
        >
          {t("social.copy")}
        </Button>
      </div>
    </Field>
  );
}

function ShareResult({ pack }: { pack: Pack }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center gap-3 rounded-card bg-ok/10 p-3 text-[13px] text-text">
        <Check size={16} className="text-ok" />
        {t("social.share.done", { name: pack.name })}
      </div>
      <CopyRow label={t("social.share.link")} value={pack.url} />
      <CopyRow label={t("social.share.code")} value={pack.code} />
      <CopyRow label={t("social.share.deeplink")} value={pack.deepLink} />
    </div>
  );
}

// ------------------------------------------------------------------ Pack importieren

export function PackImportDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useT();
  const vibe = useVibe();
  const conn = useSocial((s) => s.conn);
  const client = vibeClient();
  const q = useQuery({ queryKey: vqk.pack(code), queryFn: () => requireClient().packs.get(code), enabled: !!client && vibe.sharing, retry: 0, staleTime: 30_000 });
  const [busy, setBusy] = useState(false);

  if (!vibe.sharing || !client) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title={t("action.pack.title")} size="sm">
        <GateState conn={vibe.enabled && vibe.sharing ? conn : "off"} compact />
      </Dialog>
    );
  }
  const p = q.data;
  const install = async () => {
    if (!p) return;
    setBusy(true);
    try {
      const token = await client.accessToken().catch(() => null);
      const taskId = await api.vibePackInstall(p.code, null, token);
      toast.info(t("social.pack.importing", { name: p.name }));
      onClose();
      waitForTask(taskId)
        .then((task) => finishNewInstance(task.instance_id, p.name, true))
        .catch((e) => {
          if (!isCancelled(e)) toast.error(t("install.failed", { name: p.name }), errorMessage(e));
        });
    } catch (e) {
      toast.error(errText(e));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("action.pack.title")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={<PackageOpen size={14} />} onClick={install} loading={busy} disabled={!p}>
            {t("social.pack.install")}
          </Button>
        </>
      }
    >
      {q.isError ? (
        <p className="text-[13px] text-danger">{errText(q.error)}</p>
      ) : !p ? (
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12" />
          <Skeleton className="h-5 w-48" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <PackIcon pack={p} size={48} />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-text">{p.name}</div>
              <div className="truncate text-[12px] text-muted">
                {t("social.pack.by", { name: p.owner.name })} · {p.mcVersion} · {p.loader}
              </div>
            </div>
          </div>
          {p.description && <p className="line-clamp-4 whitespace-pre-wrap text-[13px] text-text">{p.description}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-dim">
            <span>
              <Link2 size={11} className="mr-1 inline" />
              {p.code}
            </span>
            {p.latestVersion && <span>v{p.latestVersion.version}</span>}
            {p.latestVersion && <span>{t("social.pack.files", { n: p.latestVersion.fileCount })}</span>}
            <span>{t("social.pack.downloads", { n: p.downloads })}</span>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function PackIcon({ pack, size }: { pack: Pick<Pack, "iconUrl" | "name">; size: number }) {
  const [bad, setBad] = useState(false);
  const ok = pack.iconUrl && pack.iconUrl.startsWith("https://") && !bad;
  return ok ? (
    <img src={pack.iconUrl!} alt="" width={size} height={size} loading="lazy" decoding="async" className="shrink-0 rounded-card object-cover" style={{ width: size, height: size }} onError={() => setBad(true)} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-card bg-surface2 text-muted" style={{ width: size, height: size }}>
      <PackageOpen size={size * 0.45} />
    </span>
  );
}

// ------------------------------------------------------------------ Gruppen

function GroupDialog({ chatId, onClose }: { chatId?: string; onClose: () => void }) {
  const t = useT();
  const ready = useReady();
  const friends = useFriends();
  const chat = useSocial((s) => (chatId ? s.chats[chatId] : undefined));
  const memberIds = new Set(chat?.members.map((m) => m.user.id) ?? []);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  if (!ready) return <NeedLogin title={t("social.group.new")} onClose={onClose} />;
  const submit = async () => {
    setBusy(true);
    try {
      const c = requireClient();
      if (chatId) await c.chats.addMembers(chatId, [...picked]);
      else {
        const ch = await c.chats.createGroup(name.trim(), [...picked]);
        useSocial.setState({ chats: { ...useSocial.getState().chats, [ch.id]: ch } });
        openSocial(ch.id);
      }
      onClose();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const list = friends.filter((f) => !memberIds.has(f.user.id));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={chatId ? t("social.group.add_members") : t("social.group.new")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={chatId ? picked.size === 0 : !name.trim()}>
            {chatId ? t("social.group.add") : t("social.group.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!chatId && (
          <Field label={t("social.group.name")}>
            <Input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label={t("social.invite.friends")}>
          <div className="scroll max-h-60 rounded-card bg-surface py-1">
            {list.length === 0 && <p className="p-3 text-[12px] text-dim">{t("social.friends.empty")}</p>}
            {list.map((f) => (
              <label key={f.user.id} className="flex h-9 cursor-pointer items-center gap-2.5 px-3 transition-colors duration-100 hover:bg-white/[.04]">
                <Checkbox
                  checked={picked.has(f.user.id)}
                  onChange={(on) => {
                    const n = new Set(picked);
                    if (on) n.add(f.user.id);
                    else n.delete(f.user.id);
                    setPicked(n);
                  }}
                />
                <Avatar user={f.user} size={22} presence={f.presence} />
                <span className="text-[13px] text-text">{f.user.name}</span>
              </label>
            ))}
          </div>

        </Field>
      </div>
    </Dialog>
  );
}

function RenameDialog({ chatId, name: initial, onClose }: { chatId: string; name: string; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("social.group.rename")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await requireClient().chats.updateGroup(chatId, { name: name.trim() });
                onClose();
              } catch (e) {
                toast.error(errText(e));
                setBusy(false);
              }
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <Input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
    </Dialog>
  );
}
