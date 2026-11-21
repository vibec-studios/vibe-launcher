// OWNER: Frontend-Agent A. Instanzseite im Aufbau der Modrinth App: Kopfblock (Icon, Name, Meta-Zeile, Spielen,
// Einstellungen, Mehr), Tab-Leiste mit Hinweisen, Crash-Banner, darunter der aktive Bereich.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Archive, Boxes, FolderOpen, Globe2, SquareTerminal } from "lucide-react";
import { useInstance } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import type { InstanceTab } from "@/app/router";
import { instanceAccent } from "@/lib/format";
import { ErrorState, Tabs, cn } from "@/components/ui";
import { InstanceContentTab, type TypeFilter } from "@/features/content/InstanceContentTab";
import { LogsTab } from "@/features/logs/LogsTab";
import { useT } from "@/i18n";
import { WorldsTab } from "./WorldsTab";
import { ServersTab } from "./ServersTab";
import { InstanceSettingsDialog } from "./settings/InstanceSettingsDialog";
import { openInstanceSettings, useInstanceSettings } from "./settings/store";
import { BackupsTab } from "@/features/backups/BackupsTab";
import { InstanceFilesTab } from "@/features/files";
import { accentVars } from "@/components/instance/accent";
import { HeaderSkeleton, InstanceHeader } from "./InstanceHeader";
import { InstanceNotices } from "./InstanceNotices";
import { useRefreshShortcut } from "./RefreshButton";
import { PlayLinkBar } from "@/features/play/SharePlayLink";
import { PackSyncBar } from "@/features/packsync/PackSyncBar";
import { VibeyEolNotice } from "./vibeyEol/VibeyEolNotice";
import { ToolbarSlot } from "./toolbar";
import { useSimple } from "@/lib/mode";
import { simpleHides } from "@/lib/simple-mode";
import { BedrockInstanceView } from "@/features/bedrock/BedrockInstanceView";
import { CrashBanner } from "./page/CrashBanner";
import { SubNav, useWorldItems } from "./page/SubNav";
import { areaOf, useLastSub, type Area } from "./page/areas";
import { route, wrap } from "./page/route";

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
      <VibeyEolNotice instance={inst} />
      <div data-tour="play-link">
        <PlayLinkBar instanceId={inst.id} className="border-b border-line" />
      </div>
      <PackSyncBar instance={inst} className="border-b border-line" />
      <div className="relative min-h-0 flex-1">
        {area === "content" ? (
          <InstanceContentTab instance={inst} initialType={initialType} />
        ) : area === "worlds" ? (
          <div className="flex h-full flex-col">
            <div className={cn(wrap, "flex h-[60px] shrink-0 items-center gap-2 pt-3")}>
              <SubNav items={worldItems} value={active} onChange={setTab} />
              <div ref={setSlot} className="flex min-w-0 flex-1 items-center gap-2" />
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
