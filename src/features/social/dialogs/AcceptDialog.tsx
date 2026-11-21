import { useEffect, useMemo, useState } from "react";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { waitForTask, useJavaInstances } from "@/lib/queries";
import type { LoaderKind } from "@/lib/types";
import { useVibe } from "@/lib/vibe";
import { Button, Dialog, Field, Select, Skeleton, Spinner, toast } from "@/components/ui";
import { useInstanceActions } from "@/components/instance/actions";
import { loaderNames } from "@/lib/format";
import { t as tr, useT } from "@/i18n";
import { Avatar } from "../FriendsList";
import { errText, removeInviteLocal, requireClient, useSocial } from "../service";
import { openPackImport, type AcceptReq } from "../dialogStore";
import { NeedLogin, useReady } from "./common";
import { matchInstances, type JoinTarget } from "./matchInstances";

// ------------------------------------------------------------------ Einladung annehmen

export function AcceptDialog({ req, onClose }: { req: AcceptReq; onClose: () => void }) {
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
                {tgt.loader && tgt.loader !== "vanilla" ? ` · ${loaderNames[tgt.loader as LoaderKind] ?? tgt.loader}` : ""}
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
                ...candidates.map((i) => ({ value: i.id, label: i.name, hint: `${i.mc_version} · ${loaderNames[i.loader.kind]}` })),
                { value: "__new", label: newLabel },
              ]}
            />
          </Field>
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
