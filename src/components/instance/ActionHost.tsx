// Aktionen von außen (Desktop-Verknüpfung `--launch`, Deep-Links `vibelauncher://…`): immer mit Rückfrage.
import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Link2, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useJavaInstances } from "@/lib/queries";
import type { AppAction, Instance } from "@/lib/types";
import { formatLoader, instanceAccent } from "@/lib/format";
import { useVibe } from "@/lib/vibe";
import { Button, Dialog, Select, Skeleton } from "@/components/ui";
import { openInstall } from "@/components/content/installStore";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { useT } from "@/i18n";
import { InstanceIcon } from "./InstanceIcon";
import { useInstanceActions } from "./actions";
import { ServerStatusLine } from "./motd";
import { openInviteAccept, openPackImport } from "@/features/social/dialogStore";
import { PlayJoinDialog } from "@/features/play/PlayJoinDialog";
import { onAppAction } from "@/lib/appActions";

function InstallBody({ a, onDone }: { a: Extract<AppAction, { kind: "install" }>; onDone: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["project", a.source, a.project_id], queryFn: () => api.contentProject(a.source as "modrinth", a.project_id), retry: 0 });
  return (
    <ConfirmShell
      title={t("action.install.title")}
      onCancel={onDone}
      confirm={t("action.install.confirm")}
      disabled={!q.data}
      onConfirm={() => {
        const p = q.data!;
        openInstall({
          project: {
            source: p.source,
            id: p.id,
            slug: p.slug,
            title: p.title,
            icon_url: p.icon_url,
            project_type: p.project_type,
            loaders: p.loaders,
            game_versions: p.game_versions,
            author: p.author,
          },
          versionId: a.version,
        });
        onDone();
      }}
    >
      {q.isError ? (
        <p className="text-[13px] text-danger">{t("action.install.not_found", { id: a.project_id })}</p>
      ) : !q.data ? (
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-card" />
          <Skeleton className="h-5 w-48" />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <ProjectIcon src={q.data.icon_url} size={48} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-text">{q.data.title}</div>
            <div className="truncate text-meta text-muted">
              {q.data.author} · {a.source === "curseforge" ? "CurseForge" : "Modrinth"}
            </div>
          </div>
        </div>
      )}
    </ConfirmShell>
  );
}

function ConfirmShell({
  title,
  children,
  confirm,
  onConfirm,
  onCancel,
  disabled,
}: {
  title: string;
  children: React.ReactNode;
  confirm?: string;
  onConfirm?: () => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onCancel()}
      title={title}
      description={t("action.source_hint")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onCancel}>
            {confirm ? t("common.cancel") : t("common.close")}
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

function InstanceLine({ i }: { i: Instance }) {
  return (
    <div className="flex items-center gap-3">
      <InstanceIcon icon={i.icon} seed={i.id} accent={instanceAccent(i.id, i.accent)} size={44} />
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold text-text">{i.name}</div>
        <div className="truncate text-meta text-muted">
          {formatLoader(i.loader)} · Minecraft {i.mc_version}
        </div>
      </div>
    </div>
  );
}

function ActionDialog({ a, onDone }: { a: AppAction; onDone: () => void }) {
  const t = useT();
  const { data: instances = [] } = useJavaInstances();
  const { launch } = useInstanceActions();
  const recent = useMemo(() => instances.slice().sort((x, y) => (y.last_played ?? 0) - (x.last_played ?? 0)), [instances]);
  const [pick, setPick] = useState<string | null>(a.kind === "join" ? (a.instance_id ?? null) : null);
  const joinTarget = instances.find((i) => i.id === pick) ?? recent[0];

  if (a.kind === "install") return <InstallBody a={a} onDone={onDone} />;
  if (a.kind === "play_link") return <PlayJoinDialog code={a.code} onDone={onDone} />;

  if (a.kind === "launch") {
    const i = instances.find((x) => x.id === a.instance_id);
    return (
      <ConfirmShell
        title={t("action.launch.title")}
        onCancel={onDone}
        confirm={i ? t("common.play") : undefined}
        onConfirm={() => {
          if (i) launch(i);
          onDone();
        }}
      >
        {i ? <InstanceLine i={i} /> : <p className="text-[13px] text-danger">{t("action.unknown_instance", { id: a.instance_id })}</p>}
      </ConfirmShell>
    );
  }

  if (a.kind === "join") {
    return (
      <ConfirmShell
        title={t("action.join.title")}
        onCancel={onDone}
        confirm={joinTarget ? t("action.join.confirm") : undefined}
        onConfirm={() => {
          if (joinTarget) launch(joinTarget, null, a.address);
          onDone();
        }}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-card bg-surface px-3 py-2.5">
            <div className="flex items-center gap-2 text-[13px] font-medium text-text">
              <Link2 size={14} className="text-dim" />
              {a.address}
            </div>
            <ServerStatusLine address={a.address} className="mt-2" />
          </div>
          {instances.length ? (
            <label className="flex flex-col gap-1.5">
              <span className="label">{t("action.join.with")}</span>
              <Select value={joinTarget?.id ?? null} onChange={setPick} options={recent.map((i) => ({ value: i.id, label: i.name, hint: i.mc_version }))} />
            </label>
          ) : (
            <p className="text-[13px] text-muted">{t("action.join.no_instances")}</p>
          )}
        </div>
      </ConfirmShell>
    );
  }

  // pack / invite: eigene Dialoge (fragen selbst nach, bevor etwas passiert)
  return <VibeAction a={a} onDone={onDone} />;
}

function VibeAction({ a, onDone }: { a: Extract<AppAction, { kind: "pack" | "invite" }>; onDone: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const vibe = useVibe();
  const enabled = a.kind === "pack" ? vibe.sharing : vibe.social;
  useEffect(() => {
    if (!enabled) return;
    if (a.kind === "pack") openPackImport(a.code);
    else openInviteAccept({ inviteId: a.id });
    onDone();
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  if (enabled) return null;
  return (
    <ConfirmShell title={a.kind === "pack" ? t("action.pack.title") : t("action.invite.title")} onCancel={onDone}>
      <div className="flex items-start gap-3 text-[13px] text-muted">
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warn" />
        <div>
          <p>{t("action.vibe_off")}</p>
          <p className="selectable mt-1 text-meta text-dim">{a.kind === "pack" ? a.code : a.id}</p>
          <Button
            size="sm"
            className="mt-3"
            onClick={() => {
              onDone();
              nav({ to: "/settings", search: { tab: "vibe" } });
            }}
          >
            {t("action.open_settings")}
          </Button>
        </div>
      </div>
    </ConfirmShell>
  );
}

/** Wird einmal global eingebunden. */
export function ActionHost() {
  const [queue, setQueue] = useState<AppAction[]>([]);
  useEffect(() => {
    let dead = false;
    const take = () =>
      api
        .appActionsTake()
        .then((l) => !dead && l.length && setQueue((q) => [...q, ...l]))
        .catch(() => {});
    take();
    const un = listen("app://actions", take);
    const unLocal = onAppAction((a) => setQueue((q) => [...q, a]));
    return () => {
      dead = true;
      unLocal();
      un.then((f) => f()).catch(() => {});
    };
  }, []);
  const current = queue[0];
  if (!current) return null;
  return <ActionDialog key={JSON.stringify(current)} a={current} onDone={() => setQueue((q) => q.slice(1))} />;
}
