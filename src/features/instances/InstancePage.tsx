// OWNER: Frontend-Agent A. Instanzseite im Aufbau der Modrinth App: Kopfblock (Icon, Name, Meta-Zeile, Spielen,
// Einstellungen, Mehr), Tab-Leiste mit Hinweisen, Crash-Banner, darunter der aktive Bereich.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { create } from "zustand";
import { AlertTriangle, Archive, Boxes, FileText, FolderOpen, Globe2, SquareTerminal, Stethoscope, UploadCloud, X } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useGameState, useInstance } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import type { InstanceTab } from "@/app/router";
import { instanceAccent } from "@/lib/format";
import { Button, ErrorState, IconButton, Tabs, cn } from "@/components/ui";
import { InstanceContentTab, type TypeFilter } from "@/features/content/InstanceContentTab";
import { LogsTab, showLogFile, uploadCrash } from "@/features/logs/LogsTab";
import { useT } from "@/i18n";
import { WorldsTab } from "./WorldsTab";
import { ServersTab } from "./ServersTab";
import { DiagnosisCard, DiagnosisDialog, diagText, useDiagnosis } from "@/features/logs/Diagnosis";
import { AutofixButton } from "@/features/content/AutoFix";
import { ReportProblemButton } from "@/features/feedback/FeedbackDialog";
import { InstanceSettingsDialog } from "./settings/InstanceSettingsDialog";
import { openInstanceSettings, useInstanceSettings } from "./settings/store";
import { BackupsTab } from "@/features/backups/BackupsTab";
import { InstanceFilesTab } from "@/features/files";
import { accentVars } from "@/components/instance/accent";
import { HeaderSkeleton, InstanceHeader } from "./InstanceHeader";
import { InstanceNotices } from "./InstanceNotices";
import { useRefreshShortcut } from "./RefreshButton";
import { PlayLinkBar } from "@/features/play/SharePlayLink";
import { VibeyClientBadge } from "@/features/cosmetics/VibeyClientSlot";
import { ToolbarSlot } from "./toolbar";
import { useSimple } from "@/lib/mode";
import { simpleHides, type InstanceArea } from "@/lib/simple-mode";
import { BedrockInstanceView } from "@/features/bedrock/BedrockInstanceView";
import { HelpLink } from "@/features/help/HelpButton";

const route = getRouteApi("/instances/$id");
const wrap = "w-full px-6";

function CrashBanner({ instance }: { instance: Instance }) {
  const t = useT();
  const nav = route.useNavigate();
  const game = useGameState(instance.id);
  const key = game?.crashed && game.state === "stopped" ? `${game.started_at}:${game.exit_code}` : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const crashReport = game?.crash_report ?? null;
  const diag = useDiagnosis(instance.id, crashReport, game?.exit_code ?? null, !!key && dismissed !== key);
  const top = diag.data?.[0];
  const simple = useSimple();
  if (!key || dismissed === key) return null;
  if (simple) {
    // Simple: verständliche Meldung mit „Beheben“ – keine Exit-Codes, Dateinamen, Logs
    return (
      <div data-tour="crash-banner" className="shrink-0 bg-danger/[.08] shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--color-danger)_25%,transparent)] animate-fade-in">
        <div className={cn(wrap, "flex items-center gap-3 py-3")}>
          <AlertTriangle size={18} className="shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-text">{t("simple.crash.title")}</div>
            <div className="text-[12.5px] text-muted">{t("simple.crash.text")}</div>
          </div>
          <AutofixButton req={{ instanceId: instance.id, crashReport, exitCode: game?.exit_code ?? null, launchAfter: true }} size="md" label={t("crash.offer.fix")} />
          <ReportProblemButton instanceId={instance.id} size="md" />
          <HelpLink guide="autofix" />
          <IconButton label={t("common.close")} size="sm" className="border-transparent" onClick={() => setDismissed(key)}>
            <X size={15} />
          </IconButton>
        </div>
      </div>
    );
  }
  // „Absturz erkannt – automatisch beheben?“: wahrscheinlichste Ursache gleich nennen
  const found = diag.data?.filter((d) => d.id !== "exit_code") ?? [];
  const offer = found.length
    ? t(found.length === 1 ? "crash.offer.text_1" : "crash.offer.text", { n: found.length, title: diagText(found[0], t).title })
    : diag.data
      ? t("crash.offer.none")
      : null;
  return (
    <div data-tour="crash-banner" className="shrink-0 bg-danger/[.08] shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--color-danger)_25%,transparent)] animate-fade-in">
      <div className={cn(wrap, "flex items-center gap-3 py-2.5")}>
        <AlertTriangle size={18} className="shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-text">{t("crash.offer.title")}</div>
          {/* Dateiname des Crash-Reports nur im Tooltip – er steht ohnehin unter „Logs öffnen“ */}
          <div className="truncate text-[12px] text-muted" title={game?.crash_report?.split(/[\\/]/).pop()}>
            {offer ?? (game?.exit_code != null ? t("inst.crash.code", { code: game.exit_code }) : t("inst.crash.text"))}
          </div>
        </div>
        <AutofixButton req={{ instanceId: instance.id, crashReport, exitCode: game?.exit_code ?? null }} label={t("crash.offer.fix")} />
        <HelpLink guide="autofix" />
        <Button size="sm" icon={<Stethoscope size={13} />} onClick={() => setDetails(true)}>
          {t("diag.open")}
          {diag.data && diag.data.length > 0 && <span className="text-[12px] text-muted">{diag.data.length}</span>}
        </Button>
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
        {/* Hochladen ist nichts Gefährliches -> ruhiger Text-Knopf statt rotem Knopf */}
        <Button
          size="sm"
          variant="subtle"
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
        <ReportProblemButton instanceId={instance.id} />
        <IconButton label={t("common.close")} size="sm" className="border-transparent" onClick={() => setDismissed(key)}>
          <X size={15} />
        </IconButton>
      </div>
      {top && (
        <div className={cn(wrap, "pb-3")}>
          <DiagnosisCard d={top} inst={instance} crashReport={crashReport} compact />
        </div>
      )}
      <DiagnosisDialog inst={instance} crashReport={crashReport} exitCode={game?.exit_code ?? null} open={details} onOpenChange={setDetails} />
    </div>
  );
}

// ------------------------------------------------------------------ Bereiche
// Tabs wie in der Modrinth App: Inhalte, Welten, Logs, Dateien, Backups; Einstellungen als Popup über das Zahnrad
// im Kopf (alte Deep-Links `?tab=settings` öffnen das Popup).
// Die URL behält die bisherigen Tab-Werte (Deep-Links bleiben gültig): content/resourcepacks/shaders öffnen die
// Inhalte (mit passendem Typ-Filter), worlds/servers die Welten.
type Area = InstanceArea;
const areaOf: Record<InstanceTab, Area> = {
  content: "content",
  resourcepacks: "content",
  shaders: "content",
  worlds: "worlds",
  servers: "worlds",
  logs: "logs",
  files: "files",
  backups: "backups",
  settings: "content",
};

/** Zuletzt geöffnete Unterseite je Bereich (bleibt beim Wechsel erhalten). */
const useLastSub = create<Partial<Record<Area, InstanceTab>>>(() => ({}));

interface SubItem {
  value: InstanceTab;
  label: string;
  count?: number;
}

/** Welten | Server als kompakter Segment-Umschalter links in der Werkzeugzeile. */
function SubNav({ items, value, onChange }: { items: SubItem[]; value: InstanceTab; onChange: (v: InstanceTab) => void }) {
  const t = useT();
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-ctl bg-field p-0.5" role="tablist" aria-label={t("ipage.sub.label")}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[max(0px,calc(var(--r-ctl)-2px))] px-2.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors duration-100",
              active ? "bg-surface3 text-text" : "text-muted hover:text-text",
            )}
          >
            {it.label}
            {it.count !== undefined && <span className={cn("text-[11.5px] font-medium tabular-nums", active ? "text-muted" : "text-dim")}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

function useWorldItems(id: string, enabled: boolean): SubItem[] {
  const t = useT();
  const worlds = useQuery({ queryKey: qk.worlds(id), queryFn: () => api.worldsList(id), enabled });
  const servers = useQuery({ queryKey: ["servers", id], queryFn: () => api.instanceServersList(id), enabled });
  return [
    { value: "worlds", label: t("inst.tab.worlds"), count: worlds.data?.length },
    { value: "servers", label: t("inst.tab.servers"), count: servers.data?.length },
  ];
}

export function InstancePage() {
  const { id } = route.useParams();
  const { tab } = route.useSearch();
  const nav = useNavigate();
  const { data: inst, isError, error, refetch } = useInstance(id);

  // Gelöschte Instanz (z. B. aus einem anderen Fenster) -> zurück zur Liste
  useEffect(() => {
    if (isError && (error as { kind?: string })?.kind === "not_found") nav({ to: "/instances", replace: true });
  }, [isError, error, nav]);

  if (!inst) {
    return (
      <div className="flex h-full flex-col">{isError ? <ErrorState error={error} onRetry={() => refetch()} className="flex-1" /> : <HeaderSkeleton />}</div>
    );
  }
  // Eigener Baum je Instanz: Abfragen behalten sonst (placeholderData) kurz die Daten der vorigen Instanz
  if (inst.bedrock) return <BedrockInstanceView key={inst.id} inst={inst} tab={tab} />;
  return <InstanceView key={inst.id} inst={inst} tab={tab} />;
}

function InstanceView({ inst, tab }: { inst: Instance; tab: InstanceTab }) {
  const t = useT();
  const navTab = route.useNavigate();
  const simple = useSimple();
  const active: InstanceTab = simpleHides.instanceArea(simple, areaOf[tab]) ? "content" : tab;
  const area = areaOf[active];
  const worldItems = useWorldItems(inst.id, area === "worlds");
  // F5 / Strg+R: Mods, Updates und Probleme neu prüfen (wie der Knopf im Kopf)
  useRefreshShortcut(inst.id);
  // Aktuelle Unterseite merken (auch wenn sie per Link geöffnet wurde)
  useEffect(() => {
    if (active !== "settings") useLastSub.setState({ [area]: active });
  }, [area, active]);
  // `?tab=settings` (alte Links, „Einstellungen“ aus Menüs): Popup öffnen, Seite bleibt bei den Inhalten
  useEffect(() => {
    if (active !== "settings") return;
    openInstanceSettings(inst.id);
    navTab({ search: { tab: useLastSub.getState().content ?? "content" }, replace: true });
  }, [active, inst.id, navTab]);
  const settingsOpen = useInstanceSettings((s) => s.instanceId === inst.id);
  const setTab = (v: InstanceTab) => navTab({ search: { tab: v }, replace: true });
  const openArea = (a: Area) => {
    if (a === area) return;
    const last = useLastSub.getState()[a];
    const first: Record<Area, InstanceTab> = { content: "content", worlds: "worlds", logs: "logs", files: "files", backups: "backups" };
    setTab(last ?? first[a]);
  };

  const accent = instanceAccent(inst.id, inst.accent);
  const initialType: TypeFilter = active === "resourcepacks" ? "resourcepack" : active === "shaders" ? "shader" : "all";
  // Werkzeugzeile der Welten: Welten|Server links, Werkzeuge der Unterseite (PageTools) rechts
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);

  return (
    <div className="flex h-full flex-col" style={accentVars(accent)}>
      <InstanceHeader
        instance={inst}
        accent={accent}
        settingsActive={settingsOpen}
        onSettings={() => openInstanceSettings(inst.id)}
        badge={<VibeyClientBadge instance={inst} label={t("ipage.vibey_active")} onClick={() => openInstanceSettings(inst.id, "vibe")} />}
        tabs={
          <Tabs<Area | "">
            value={area}
            onChange={(a) => a && openArea(a)}
            className="-mx-3 h-11! gap-1 border-b-0"
            items={(
              [
                { value: "content", label: t("ipage.tab.content"), icon: <Boxes size={15} /> },
                { value: "worlds", label: t("ipage.tab.worlds"), icon: <Globe2 size={15} /> },
                { value: "logs", label: t("ipage.tab.logs"), icon: <SquareTerminal size={15} /> },
                { value: "files", label: t("inst.tab.files"), icon: <FolderOpen size={15} /> },
                { value: "backups", label: t("inst.tab.backups"), icon: <Archive size={15} /> },
              ] as { value: Area; label: string; icon: React.ReactNode }[]
            ).filter((it) => !simpleHides.instanceArea(simple, it.value))}
          />
        }
        notices={<InstanceNotices instance={inst} tab={active} />}
      />
      <CrashBanner instance={inst} />
      <div data-tour="play-link">
        <PlayLinkBar instanceId={inst.id} className="border-b border-line" />
      </div>
      <div className="relative min-h-0 flex-1">
        {area === "content" ? (
          <InstanceContentTab instance={inst} initialType={initialType} />
        ) : area === "worlds" ? (
          <div className="flex h-full flex-col">
            <div className={cn(wrap, "flex h-14 shrink-0 items-center gap-2 pt-2")}>
              <SubNav items={worldItems} value={active} onChange={setTab} />
              <div ref={setSlot} className="flex min-w-0 flex-1 items-center gap-1" />
            </div>
            <ToolbarSlot.Provider value={slot}>
              <div className="relative min-h-0 flex-1">{active === "servers" ? <ServersTab instance={inst} /> : <WorldsTab instance={inst} />}</div>
            </ToolbarSlot.Provider>
          </div>
        ) : area === "backups" ? (
          <BackupsTab instance={inst} />
        ) : area === "logs" ? (
          <LogsTab instance={inst} />
        ) : (
          <InstanceFilesTab instance={inst} />
        )}
      </div>
      <InstanceSettingsDialog instance={inst} />
    </div>
  );
}
