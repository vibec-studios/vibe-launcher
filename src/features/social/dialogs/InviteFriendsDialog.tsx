import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Server as ServerIcon } from "lucide-react";
import { useState } from "react";
import { useVibe } from "@/lib/vibe";
import type { HostSession } from "@/lib/vibe-sdk";
import { Button, Dialog, Field, Input, Select, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { useFriends } from "../hooks";
import { errText, requireClient, vqk } from "../service";
import type { DialogState } from "../dialogStore";
import { FriendChecklist, NeedLogin, useReady } from "./common";
import { useHostedServers } from "./useHostedServers";

// ------------------------------------------------------------------ Freunde einladen

export function InviteFriendsDialog({ init, onClose }: { init: NonNullable<DialogState["inviteFriends"]>; onClose: () => void }) {
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
  if (!vibe.hosting || hosted.length === 0) {
    const toServers = () => {
      onClose();
      nav({ to: "/servers" });
    };
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={t("social.invite.title")}
        size="sm"
        footer={
          <>
            <Button variant="subtle" onClick={onClose}>
              {t("common.close")}
            </Button>
            {vibe.hosting && (
              <Button variant="primary" icon={<ServerIcon size={14} />} onClick={toServers} autoFocus>
                {t("uic.invite.to_servers")}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col items-center gap-3 px-2 pb-2 pt-3 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-card bg-surface2 text-muted">
            <ServerIcon size={22} />
          </span>
          <div className="text-[15px] font-semibold text-text">{t("uic.invite.no_server.title")}</div>
          <p className="text-[13px] leading-relaxed text-muted">{vibe.hosting ? t("uic.invite.no_server.text") : t("social.invite.hosting_off")}</p>
        </div>
      </Dialog>
    );
  }
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
        <Field label={t("social.invite.server")}>
          <Select
            value={target?.server.id ?? null}
            onChange={setServerId}
            options={hosted.map((h) => ({ value: h.server.id, label: h.server.name, hint: h.address }))}
          />
          {target?.kind === "direct" && <p className="mt-1.5 text-[12px] text-warn">{t("social.invite.lan_hint")}</p>}
        </Field>
        {limits.data && (
          <p className="font-mono text-[11px] text-dim">
            {t("social.hosting.limits", { active: limits.data.active, max: limits.data.maxHosts })}
            {limits.data.maxPlayersPerHost ? ` · ${t("social.hosting.players", { n: limits.data.maxPlayersPerHost })}` : ""}
          </p>
        )}
        {!init.chatId && (
          <Field label={t("social.invite.friends")}>
            <FriendChecklist friends={friends} picked={picked} onPick={setPicked} className="scroll max-h-52 rounded-card bg-surface py-1" emptyText={t("social.friends.empty")} />
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
