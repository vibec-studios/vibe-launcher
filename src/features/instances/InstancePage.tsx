// OWNER: Frontend-Agent A. Instanzseite: kompakter Kopf (Icon, Name, Metazeile, Spielen/Ordner/Mehr),
// Tabs (Mods, Resourcepacks, Shader, Welten, Logs, Einstellungen), Crash-Banner.
import { useEffect, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, FileText, FolderOpen, MoreHorizontal, UploadCloud, X } from "lucide-react";
import { useGameState, useInstance } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import type { InstanceTab } from "@/app/router";
import { formatDuration, formatRelative, instanceAccent, loaderNames } from "@/lib/format";
import { Button, DropdownMenu, ErrorState, IconButton, Skeleton, Tabs, Tooltip, cn } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { StatusHint } from "@/components/instance/InstanceCard";
import { InstanceDropdownContent } from "@/components/instance/InstanceMenu";
import { PlayButton } from "@/components/instance/PlayButton";
import { openFolder, setIcon } from "@/components/instance/actions";
import { InstanceContentTab } from "@/features/content/InstanceContentTab";
import { LogsTab, showLogFile, uploadCrash } from "@/features/logs/LogsTab";
import { useT } from "@/i18n";
import { WorldsTab } from "./WorldsTab";
import { ActiveModSet } from "@/features/content/ModSetsMenu";
import { InstanceSettingsTab } from "./InstanceSettingsTab";
import { BackupsTab } from "@/features/backups/BackupsTab";
import { accentVars } from "@/components/instance/accent";

const route = getRouteApi("/instances/$id");
const wrap = "w-full px-6";

function CrashBanner({ instance }: { instance: Instance }) {
  const t = useT();
  const nav = route.useNavigate();
  const game = useGameState(instance.id);
  const key = game?.crashed && game.state === "stopped" ? `${game.started_at}:${game.exit_code}` : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!key || dismissed === key) return null;
  return (
    <div className="shrink-0 border-b border-danger/30 bg-danger/[.08] animate-fade-in">
      <div className={cn(wrap, "flex items-center gap-3 py-2.5")}>
        <AlertTriangle size={18} className="shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-white">{t("inst.crash.title")}</div>
          <div className="truncate text-[12px] text-muted">
            {game?.exit_code != null ? t("inst.crash.code", { code: game.exit_code }) : t("inst.crash.text")}
            {game?.crash_report && <span className="font-mono text-dim"> · {game.crash_report.split(/[\\/]/).pop()}</span>}
          </div>
        </div>
        <Button
          size="sm"
          icon={<FileText size={13} />}
          onClick={() => {
            if (game?.crash_report) showLogFile(instance.id, game.crash_report);
            nav({ search: { tab: "logs" } });
          }}
        >
          {t("inst.crash.logs")}
        </Button>
        <Button
          size="sm"
          variant="danger"
          loading={busy}
          icon={<UploadCloud size={13} />}
          onClick={async () => {
            setBusy(true);
            await uploadCrash(instance.id, game?.crash_report ?? null);
            setBusy(false);
          }}
        >
          {t("logs.upload")}
        </Button>
        <IconButton label={t("common.close")} size="sm" className="border-transparent" onClick={() => setDismissed(key)}>
          <X size={15} />
        </IconButton>
      </div>
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <header className="shrink-0 border-b border-line">
      <div className={cn(wrap, "flex items-center gap-4 pb-3 pt-5")}>
        <Skeleton className="h-16 w-16" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-10 w-[136px]" />
      </div>
      <div className={cn(wrap, "flex h-11 items-center gap-6")}>
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-3.5 w-16" />
        ))}
      </div>
    </header>
  );
}

/** Metazeile: „Fabric 0.16.9 · Minecraft 1.21.4 · 12 h gespielt · Modpack …“ */
function MetaLine({ instance: i }: { instance: Instance }) {
  const t = useT();
  const src = i.source;
  const parts: React.ReactNode[] = [
    i.loader.kind === "vanilla" ? "Vanilla" : `${loaderNames[i.loader.kind]}${i.loader.version ? ` ${i.loader.version}` : ""}`,
    `Minecraft ${i.mc_version}`,
  ];
  if (i.play_time_secs >= 60) parts.push(t("inst.meta.played", { time: formatDuration(i.play_time_secs) }));
  parts.push(i.last_played ? t("inst.meta.last", { when: formatRelative(i.last_played) }) : t("inst.never_played"));
  if (src) parts.push(`${t("inst.modpack")}: ${src.name ?? src.kind}${src.version_name ? ` ${src.version_name}` : ""}`);
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted">
      {parts.map((p, n) => (
        <span key={n} className="flex items-center gap-2 whitespace-nowrap">
          {n > 0 && <span className="text-dim">·</span>}
          {p}
        </span>
      ))}
      <StatusHintInline instance={i} />
      <span className="flex items-center gap-2 whitespace-nowrap before:text-dim before:content-['·'] empty:hidden">
        <ActiveModSet instanceId={i.id} />
      </span>
    </div>
  );
}

function StatusHintInline({ instance }: { instance: Instance }) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap before:text-dim before:content-['·'] empty:hidden">
      <StatusHint instance={instance} />
    </span>
  );
}

export function InstancePage() {
  const t = useT();
  const { id } = route.useParams();
  const { tab } = route.useSearch();
  const navTab = route.useNavigate();
  const nav = useNavigate();
  const { data: inst, isError, error, refetch } = useInstance(id);

  const vanilla = inst?.loader.kind === "vanilla";
  const active: InstanceTab = vanilla && tab === "content" ? "resourcepacks" : tab;
  const setTab = (v: InstanceTab) => navTab({ search: { tab: v }, replace: true });

  // Gelöschte Instanz (z. B. aus einem anderen Fenster) -> zurück zur Liste
  useEffect(() => {
    if (isError && (error as { kind?: string })?.kind === "not_found") nav({ to: "/instances", replace: true });
  }, [isError, error, nav]);

  if (!inst) {
    return (
      <div className="flex h-full flex-col">{isError ? <ErrorState error={error} onRetry={() => refetch()} className="flex-1" /> : <HeaderSkeleton />}</div>
    );
  }

  const accent = instanceAccent(inst.id, inst.accent);

  return (
    <div className="flex h-full flex-col" style={accentVars(accent)}>
      <header className="shrink-0 border-b border-line bg-panel">
        <div className={cn(wrap, "flex items-center gap-4 pb-3 pt-5")}>
          <Tooltip content={t("inst.icon.choose")}>
            <button onClick={() => setIcon(inst)} className="shrink-0" aria-label={t("inst.icon.choose")}>
              <InstanceIcon icon={inst.icon} accent={accent} size={64} />
            </button>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <h1 className="display truncate text-[22px]" title={inst.name}>
              {inst.name}
            </h1>
            <MetaLine instance={inst} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PlayButton instance={inst} size="md" />
            <Tooltip content={t("common.open_folder")}>
              <IconButton label={t("common.open_folder")} className="h-10 w-10" onClick={() => openFolder(inst)}>
                <FolderOpen size={17} />
              </IconButton>
            </Tooltip>
            <DropdownMenu
              trigger={
                <IconButton label={t("common.more")} className="h-10 w-10 data-[state=open]:bg-surface3 data-[state=open]:text-white">
                  <MoreHorizontal size={17} />
                </IconButton>
              }
            >
              <InstanceDropdownContent instance={inst} onDeleted={() => nav({ to: "/instances" })} />
            </DropdownMenu>
          </div>
        </div>
        <div className={wrap}>
          <Tabs<InstanceTab>
            value={active}
            onChange={setTab}
            className="-mx-3 h-11! border-b-0"
            items={[
              ...(vanilla ? [] : [{ value: "content" as const, label: t("inst.tab.mods") }]),
              { value: "resourcepacks", label: t("inst.tab.resourcepacks") },
              { value: "shaders", label: t("inst.tab.shaders") },
              { value: "worlds", label: t("inst.tab.worlds") },
              { value: "backups", label: t("inst.tab.backups") },
              { value: "logs", label: t("inst.tab.logs") },
              { value: "settings", label: t("inst.tab.settings") },
            ]}
          />
        </div>
      </header>
      <CrashBanner instance={inst} />
      <div className="relative min-h-0 flex-1">
        {active === "content" || active === "resourcepacks" || active === "shaders" ? (
          <div className="h-full overflow-y-auto overflow-x-hidden overscroll-contain">
            <InstanceContentTab key={active} instance={inst} kind={active === "content" ? "mod" : active === "resourcepacks" ? "resourcepack" : "shader"} />
          </div>
        ) : active === "worlds" ? (
          <WorldsTab instance={inst} />
        ) : active === "backups" ? (
          <BackupsTab instance={inst} />
        ) : active === "logs" ? (
          <LogsTab instance={inst} />
        ) : (
          <InstanceSettingsTab instance={inst} />
        )}
      </div>
    </div>
  );
}
