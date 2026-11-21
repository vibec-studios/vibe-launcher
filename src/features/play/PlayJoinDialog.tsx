// „Spiel mit mir“-Link (`vibelauncher://join/<code>`, docs/PLAY-LINKS.md): Details laden, nachfragen, passende
// Instanz nehmen oder anlegen, dann per Quick Play direkt in die Welt des Hosts.
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Download, Hand, Info, KeyRound, Wifi, WifiOff } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { qk, queryClient, useAccounts, useTask, waitForTask } from "@/lib/queries";
import type { AppError, JoinPreview, PlayLink } from "@/lib/types";
import { formatBytes } from "@/lib/format";
import { useVibe } from "@/lib/vibe";
import { useExpert } from "@/lib/simple-mode";
import { Button, Dialog, Progress, Skeleton, Spinner, Steps, Tag, cn, toast } from "@/components/ui";
import { reportInstalled } from "@/features/packsync/api";
import { PlayerHead } from "@/components/PlayerHead";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { useInstanceActions } from "@/components/instance/actions";
import { MsaDialog } from "@/features/accounts/MsaDialog";
import { t as tt, useT } from "@/i18n";

const LOADERS: Record<string, string> = { vanilla: "Vanilla", fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge" };
const CLIENTS: Record<string, string> = { vibey: "Vibey Client", norisk: "NoRisk Client", "norisk-mini": "NoRisk Mini", essential: "Essential" };

const errKind = (e: unknown) => (e as AppError | undefined)?.kind;

export function PlayJoinDialog({ code, onDone }: { code: string; onDone: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const vibe = useVibe();
  const link = useQuery({ queryKey: ["play-link", code], queryFn: () => api.playLinkGet(code), retry: 0, staleTime: 30_000, enabled: vibe.enabled });

  if (!vibe.enabled) {
    return (
      <Shell title={t("play.title")} onClose={onDone}>
        <Notice tone="warn" icon={<WifiOff size={16} />} title={t("play.vibe_off")}>
          <Button size="sm" className="mt-3" onClick={() => (onDone(), nav({ to: "/settings", search: { tab: "vibe" } }))}>
            {t("action.open_settings")}
          </Button>
        </Notice>
      </Shell>
    );
  }
  if (link.isError) {
    const expired = errKind(link.error) === "not_found";
    return (
      <Shell title={expired ? t("play.expired.title") : t("play.title")} onClose={onDone} retry={expired ? undefined : () => link.refetch()}>
        {expired ? (
          <Notice tone="muted" icon={<Clock size={16} />} title={t("play.expired.text")}>
            <p className="mt-1 text-meta text-dim">{t("play.expired.hint")}</p>
          </Notice>
        ) : (
          <Notice tone="danger" icon={<AlertTriangle size={16} />} title={t("play.load_failed")}>
            <p className="selectable mt-1 text-meta text-dim">{errorMessage(link.error)}</p>
          </Notice>
        )}
      </Shell>
    );
  }
  if (!link.data) {
    return (
      <Shell title={t("play.title")} onClose={onDone}>
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-56" />
          </div>
        </div>
      </Shell>
    );
  }
  return <JoinBody link={link.data} onDone={onDone} />;
}

function JoinBody({ link, onDone }: { link: PlayLink; onDone: () => void }) {
  const t = useT();
  const tech = useExpert("tech-details");
  const nav = useNavigate();
  const { launch } = useInstanceActions();
  const accounts = useAccounts();
  const [msa, setMsa] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [phase, setPhase] = useState(0);
  const task = useTask(taskId);
  const preview = useQuery({ queryKey: ["play-preview", link.code], queryFn: () => api.playJoinPreview(link), retry: 0, staleTime: 60_000 });
  const p = preview.data;
  const noAccount = accounts.data !== undefined && accounts.data.length === 0;
  const vp = link.vibe_pack?.available ? link.vibe_pack : null;
  const title = link.world_name || vp?.name || link.pack?.title || `Minecraft ${link.mc_version}`;
  const needsSetup = !!p && (p.create || p.mods > 0 || !!p.client_pack || !!p.pack_update);

  const start = async () => {
    if (!p) return;
    setFailed(null);
    setPhase(1);
    try {
      const id = await api.playJoinSetup(link, p.instance_id);
      setTaskId(id);
      const done = await waitForTask(id);
      const instanceId = done.instance_id ?? p.instance_id;
      if (!instanceId) throw new Error(tt("play.no_instance"));
      await queryClient.invalidateQueries({ queryKey: qk.instances });
      if (p.pack_update) {
        const installId = await api.instanceInstall(instanceId);
        setTaskId(installId);
        await waitForTask(installId);
      }
      const inst = await api.instanceGet(instanceId);
      if (vp) void reportInstalled(vp.code, inst.source?.version_id ?? vp.version_id);
      setPhase(2);
      onDone();
      if (p.manual.length) {
        nav({ to: "/instances/$id", params: { id: inst.id }, search: { tab: "content" } });
        toast.info(tt("play.manual_title"), tt("play.manual_text", { n: p.manual.length }), undefined, 12000);
        return;
      }
      if (!link.active) {
        toast.success(tt("play.ready_offline", { name: link.host.name }), inst.name, {
          label: tt("play.join_now"),
          onClick: () => void launch(inst, null, link.relay_host),
        });
        return;
      }
      void launch(inst, null, link.relay_host);
    } catch (e) {
      setPhase(0);
      if (errKind(e) === "cancelled") {
        setTaskId(null);
        return;
      }
      setFailed(errorMessage(e));
      setTaskId(null);
    }
  };

  const running = !!taskId && !failed;
  const blocked = !p || !!p.problem || noAccount;
  const confirm = !link.active ? t("play.confirm.setup") : needsSetup ? t("play.confirm.setup_join") : t("play.confirm.join");

  return (
    <>
      <Shell
        title={t("play.invites", { name: link.host.name })}
        onClose={onDone}
        confirm={running ? undefined : confirm}
        onConfirm={() => void start()}
        disabled={blocked}
        closeLabel={running ? t("play.background") : undefined}
      >
        <div className="flex flex-col gap-4">
          {/* Host + Welt */}
          <div className="flex items-center gap-3.5">
            <PlayerHead uuid={link.host.uuid} name={link.host.name} size={48} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-semibold text-text">{title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-meta text-muted">
                {link.active ? <Wifi size={12} className="text-ok" /> : <WifiOff size={12} className="text-warn" />}
                {link.active ? t("play.host_online", { name: link.host.name }) : t("play.host_offline", { name: link.host.name })}
                {link.max_players ? <span className="text-dim">· {t("play.slots", { n: link.max_players })}</span> : null}
              </div>
            </div>
          </div>

          {/* Spiel / Modpack */}
          <div className="flex flex-col divide-y divide-line rounded-card bg-surface">
            <Row label={t("play.row.game")}>
              Minecraft {link.mc_version}
              {link.loader.kind !== "vanilla" && (
                <span className="text-muted">
                  {" "}
                  · {LOADERS[link.loader.kind] ?? link.loader.kind}
                  {link.loader.version ? ` ${link.loader.version}` : ""}
                </span>
              )}
            </Row>
            {vp ? (
              <Row label={t("play.row.pack")}>
                <span className="flex min-w-0 items-center gap-2">
                  {vp.icon_url && <ProjectIcon src={vp.icon_url} size={20} />}
                  <span className="truncate">{vp.name}</span>
                  {vp.version && <span className="shrink-0 text-dim">{vp.version}</span>}
                  <Tag className="shrink-0">{t("pjoin.vibe_pack")}</Tag>
                </span>
              </Row>
            ) : (link.pack || p?.pack_title) && (
              <Row label={t("play.row.pack")}>
                <span className="flex min-w-0 items-center gap-2">
                  {p?.pack_icon && <ProjectIcon src={p.pack_icon} size={20} />}
                  <span className="truncate">{p?.pack_title ?? link.pack?.title ?? link.pack?.project_id}</span>
                  {p?.pack_version && <span className="shrink-0 text-dim">{p.pack_version}</span>}
                </span>
              </Row>
            )}
            {!link.pack && link.mods.length > 0 && <Row label={t("play.row.mods")}>{t("play.mods_n", { n: link.mods.length })}</Row>}
          </div>

          {/* Was passiert */}
          {preview.isError ? (
            <Notice tone="danger" icon={<AlertTriangle size={16} />} title={t("play.preview_failed")}>
              <p className="selectable mt-1 text-meta text-dim">{errorMessage(preview.error)}</p>
            </Notice>
          ) : !p ? (
            <div className="flex items-center gap-2.5 text-[13px] text-muted">
              <Spinner size={13} className="text-brand" />
              {t("play.checking")}
            </div>
          ) : p.problem ? (
            <Notice tone="danger" icon={<AlertTriangle size={16} />} title={t(`play.problem.${p.problem}`)}>
              {p.problem_detail && tech && <p className="selectable mt-1 text-meta text-dim">{p.problem_detail}</p>}
            </Notice>
          ) : (
            <InstallPlan p={p} />
          )}

          {p && !p.problem && p.manual.length > 0 && (
            <Notice tone="warn" icon={<Hand size={16} />} title={t("play.manual", { n: p.manual.length })}>
              <p className="mt-1 text-meta text-dim">{p.manual.slice(0, 4).join(", ") + (p.manual.length > 4 ? " …" : "")}</p>
              <p className="mt-1 text-meta text-muted">{t("play.manual_hint")}</p>
            </Notice>
          )}

          {!link.active && (
            <Notice tone="warn" icon={<WifiOff size={16} />} title={t("play.offline_title", { name: link.host.name })}>
              <p className="mt-1 text-meta text-muted">{t("play.offline_text")}</p>
            </Notice>
          )}

          {noAccount && (
            <Notice tone="warn" icon={<KeyRound size={16} />} title={t("play.need_account")}>
              <Button size="sm" variant="primary" className="mt-3" onClick={() => setMsa(true)}>
                {t("play.sign_in")}
              </Button>
            </Notice>
          )}

          {running && (
            <Steps steps={[t("pjoin.step.check"), vp ? t("pjoin.step.pack") : t("pjoin.step.setup"), t("pjoin.step.join")]} current={phase} />
          )}
          {running && task && (
            <div className="flex flex-col gap-2 rounded-card bg-surface p-3">
              <div className="flex items-center gap-2 text-[13px] text-text">
                <Spinner size={13} className="text-brand" />
                <span className="min-w-0 flex-1 truncate">{task.message ?? t("play.preparing")}</span>
              </div>
              <Progress value={task.progress} />
            </div>
          )}
          {failed && (
            <Notice tone="danger" icon={<AlertTriangle size={16} />} title={t("play.setup_failed")}>
              <p className="selectable mt-1 text-meta text-dim">{failed}</p>
            </Notice>
          )}
        </div>
      </Shell>
      <MsaDialog open={msa} onOpenChange={setMsa} />
    </>
  );
}

function InstallPlan({ p }: { p: JoinPreview }) {
  const t = useT();
  const lines = useMemo(() => {
    const out: string[] = [];
    if (p.create) out.push(t("play.plan.create"));
    else if (p.instance_name) out.push(t("play.plan.use", { name: p.instance_name }));
    if (p.create && p.pack_title) out.push(t("play.plan.pack", { name: p.pack_title, n: p.pack_files }));
    if (p.pack_update && p.pack_title) out.push(t("pjoin.plan.update", { name: p.pack_title, from: p.pack_from_version ?? "?", to: p.pack_version ?? "?" }));
    if (p.pack_update) out.push(t("pjoin.plan.keep"));
    if (p.mods > 0) out.push(t("play.plan.mods", { n: p.mods }));
    if (p.client_pack) out.push(t("play.plan.client", { name: CLIENTS[p.client_pack] ?? p.client_pack }));
    if (p.game_download) out.push(t("play.plan.game"));
    return out;
  }, [p, t]);
  const nothing = !p.create && p.mods === 0 && !p.client_pack && !p.pack_update;
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{nothing ? t("play.plan.ready_title") : t("play.plan.title")}</span>
      <ul className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <li key={l} className="flex items-start gap-2 text-[13px] leading-snug text-text">
            <CheckCircle2 size={14} strokeWidth={2.25} className="mt-0.5 shrink-0 text-ok" />
            {l}
          </li>
        ))}
      </ul>
      {!nothing && (
        <div className="flex items-center gap-1.5 text-meta text-muted">
          <Download size={12} className="text-dim" />
          {p.download_bytes != null && p.download_bytes > 0
            ? t(p.game_download ? "play.size_plus_game" : "play.size", { size: formatBytes(p.download_bytes) })
            : p.vibe_pack
              ? t("pjoin.size_pack")
              : t("play.size_unknown")}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="w-24 shrink-0 text-meta text-dim">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-text">{children}</span>
    </div>
  );
}

function Notice({ tone, icon, title, children }: { tone: "warn" | "danger" | "muted"; icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-card bg-surface px-3 py-2.5">
      <span className={cn("mt-0.5 shrink-0", tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-dim")}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-text">{title}</p>
        {children}
      </div>
    </div>
  );
}

function Shell({
  title,
  children,
  confirm,
  onConfirm,
  onClose,
  disabled,
  retry,
  closeLabel,
}: {
  title: string;
  children: React.ReactNode;
  confirm?: string;
  onConfirm?: () => void;
  onClose: () => void;
  disabled?: boolean;
  retry?: () => void;
  closeLabel?: string;
}) {
  const t = useT();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={t("play.source_hint")}
      size="md"
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5 text-caption text-dim">
            <Info size={12} />
            {t("play.footer")}
          </span>
          {retry && (
            <Button variant="subtle" onClick={retry}>
              {t("common.retry")}
            </Button>
          )}
          <Button variant="subtle" onClick={onClose}>
            {closeLabel ?? (confirm ? t("common.cancel") : t("common.close"))}
          </Button>
          {confirm && onConfirm && (
            <Button variant="primary" onClick={onConfirm} disabled={disabled} autoFocus>
              {confirm}
            </Button>
          )}
        </>
      }
    >
      {children}
    </Dialog>
  );
}
