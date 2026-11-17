// OWNER: Frontend-Agent A. Instanzseite: Kopf im Stil von .mod-hero in der Instanz-Akzentfarbe, großer
// Spielen-Knopf, Tabs (Mods, Resourcepacks, Shader, Welten, Logs, Einstellungen), Crash-Banner.
import { useEffect, useState } from "react";
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, FileText, FolderOpen, MoreHorizontal, UploadCloud, X } from "lucide-react";
import { useGameState, useInstance } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import type { InstanceTab } from "@/app/router";
import { formatDuration, formatRelative, instanceAccent, loaderColors, loaderNames } from "@/lib/format";
import { Button, DropdownMenu, ErrorState, IconButton, Skeleton, Tabs, Tag, Tooltip, cn } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { StatusHint } from "@/components/instance/InstanceCard";
import { InstanceDropdownContent } from "@/components/instance/InstanceMenu";
import { PlayButton } from "@/components/instance/PlayButton";
import { openFolder, setIcon } from "@/components/instance/actions";
import { InstanceContentTab } from "@/features/content/InstanceContentTab";
import { LogsTab, showLogFile, uploadCrash } from "@/features/logs/LogsTab";
import { useT } from "@/i18n";
import { WorldsTab } from "./WorldsTab";
import { InstanceSettingsTab } from "./InstanceSettingsTab";
import { accentVars } from "@/components/instance/accent";

const route = getRouteApi("/instances/$id");
const wrap = "mx-auto w-full max-w-[1320px] px-8";

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
      <div className={cn(wrap, "flex items-center gap-4 py-3")}>
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
      <div className={cn(wrap, "flex items-center gap-5 pb-5 pt-5")}>
        <Skeleton className="h-[76px] w-[76px]" />
        <div className="flex flex-1 flex-col gap-2.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-4 w-52" />
        </div>
        <Skeleton className="h-[52px] w-[220px]" />
      </div>
      <div className={cn(wrap, "flex h-12 items-center gap-6")}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-3 w-20" />
        ))}
      </div>
    </header>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-dim">{label}</span>
      <span className="text-muted">{children}</span>
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
  const src = inst.source;

  return (
    <div className="flex h-full flex-col" style={accentVars(accent)}>
      <header
        className="relative shrink-0 border-b border-line"
        style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 20%, #000) 0%, #000 100%)` }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-50"
          style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
        />
        <div className={cn(wrap, "flex items-center gap-5 pb-4 pt-5")}>
          <Tooltip content={t("inst.icon.choose")}>
            <button
              onClick={() => setIcon(inst)}
              className="shrink-0 transition-transform duration-150 hover:-translate-y-px"
              aria-label={t("inst.icon.choose")}
            >
              <InstanceIcon icon={inst.icon} accent={accent} size={76} className="border-line2" />
            </button>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              <Link to="/instances" className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[.12em] text-dim hover:text-white">
                <ArrowLeft size={12} />
                {t("nav.instances")}
              </Link>
              <span className="text-dim">/</span>
              <span className="eyebrow truncate">
                {src ? `${t("inst.modpack")} · ${src.name ?? src.kind}${src.version_name ? ` ${src.version_name}` : ""}` : t("inst.instance")}
              </span>
            </div>
            <h1 className="display truncate text-[30px]" title={inst.name}>
              {inst.name}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[11px]">
              <span className="flex items-center gap-1.5">
                <Tag>{inst.mc_version}</Tag>
                <Tag color={loaderColors[inst.loader.kind]}>
                  {loaderNames[inst.loader.kind]}
                  {inst.loader.version && <span className="normal-case opacity-80">{inst.loader.version}</span>}
                </Tag>
              </span>
              <Meta label={t("inst.play_time")}>{inst.play_time_secs > 0 ? formatDuration(inst.play_time_secs) : "–"}</Meta>
              <Meta label={t("inst.last_played")}>{inst.last_played ? formatRelative(inst.last_played) : t("inst.never_played")}</Meta>
              <span className="uppercase tracking-[.06em]">
                <StatusHint instance={inst} />
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Tooltip content={t("common.open_folder")}>
              <IconButton label={t("common.open_folder")} className="h-[52px] w-[52px]" onClick={() => openFolder(inst)}>
                <FolderOpen size={18} />
              </IconButton>
            </Tooltip>
            <DropdownMenu
              trigger={
                <IconButton label={t("common.more")} className="h-[52px] w-[52px] data-[state=open]:border-white">
                  <MoreHorizontal size={18} />
                </IconButton>
              }
            >
              <InstanceDropdownContent instance={inst} onDeleted={() => nav({ to: "/instances" })} />
            </DropdownMenu>
            <PlayButton instance={inst} size="lg" className="ml-1" />
          </div>
        </div>
        <div className={wrap}>
          <Tabs<InstanceTab>
            value={active}
            onChange={setTab}
            className="-mx-3.5 border-b-0"
            items={[
              ...(vanilla ? [] : [{ value: "content" as const, label: t("inst.tab.mods") }]),
              { value: "resourcepacks", label: t("inst.tab.resourcepacks") },
              { value: "shaders", label: t("inst.tab.shaders") },
              { value: "worlds", label: t("inst.tab.worlds") },
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
        ) : active === "logs" ? (
          <LogsTab instance={inst} />
        ) : (
          <InstanceSettingsTab instance={inst} />
        )}
      </div>
    </div>
  );
}
