import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Compass, Home, Images, LibraryBig, Server as ServerIcon, Shirt, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/i18n";
import { isRunning, useGameStore, useInstance, useInstances, useInstanceTasks, useServer, useServerStore } from "@/lib/queries";
import type { NavKey } from "@/lib/types";
import { useLiveAppearance } from "@/lib/appearance";
import { useSimple } from "@/lib/mode";
import { useVibe } from "@/lib/vibe";
import { useSocialBadge } from "@/features/social/hooks";
import { useSettingsDialog } from "@/features/settings/store";

export type NavDef = {
  icon: ReactNode;
  label: string;
  go: (nav: ReturnType<typeof useNavigate>) => void;
  match: (path: string, at: (p: string) => boolean) => boolean;
};

export const NAV: Record<NavKey, NavDef> = {
  home: { icon: <Home size={20} />, label: "nav.home", go: (nav) => nav({ to: "/" }), match: (p) => p === "/" },
  instances: { icon: <LibraryBig size={20} />, label: "nav.instances", go: (nav) => nav({ to: "/instances" }), match: (p) => p === "/instances" || p === "/modsets" },
  servers: { icon: <ServerIcon size={20} />, label: "nav.servers", go: (nav) => nav({ to: "/servers" }), match: (_, at) => at("/servers") },
  social: { icon: <Users size={20} />, label: "nav.social", go: (nav) => nav({ to: "/social", search: {} }), match: (_, at) => at("/social") },
  discover: { icon: <Compass size={20} />, label: "nav.discover", go: (nav) => nav({ to: "/discover" }), match: (_, at) => at("/discover") || at("/project") },
  skins: { icon: <Shirt size={20} />, label: "nav.skins", go: (nav) => nav({ to: "/skins" }), match: (p) => p === "/skins" },
  cosmetics: { icon: <Sparkles size={20} />, label: "nav.cosmetics", go: (nav) => nav({ to: "/cosmetics" }), match: (_, at) => at("/cosmetics") },
  screenshots: { icon: <Images size={20} />, label: "nav.screenshots", go: (nav) => nav({ to: "/screenshots" }), match: (p) => p === "/screenshots" },
};

/** Simple-Modus: feste, kurze Navigation (Skins übers Konto-Menü; Server, Screenshots und Statistiken nur im
 *  Expert-Modus – sie setzen Technik voraus oder sind für den Einstieg nicht nötig). */
export const SIMPLE_NAV: NavKey[] = ["home", "instances", "discover", "social", "cosmetics"];

/** Gemeinsamer Zustand der Seitenleiste (v1 und v2): sichtbare Einträge, Instanzen, Abzeichen. */
export function useRailModel() {
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: instances = [] } = useInstances();
  const sidebar = useLiveAppearance((s) => s.a.sidebar);
  const simple = useSimple();
  const wide = sidebar.mode === "wide" || simple;
  const recent = sidebar.instances ? instances.slice(0, 8) : [];
  const at = (p: string) => path === p || path.startsWith(p + "/");
  const serversRunning = useServerStore((s) => Object.values(s.statuses).some((x) => x.state === "running"));
  const vibe = useVibe();
  const socialBadge = useSocialBadge();
  const settingsOpen = useSettingsDialog((s) => s.open);
  const keys = (simple ? SIMPLE_NAV : sidebar.order.filter((k) => !sidebar.hidden.includes(k))).filter(
    (k) => (k !== "social" || vibe.social) && (k !== "cosmetics" || vibe.enabled),
  );
  return { nav, path, at, wide, simple, keys, recent, serversRunning, socialBadge, settingsOpen };
}

/** Läuft die Instanz bzw. arbeitet gerade eine Aufgabe daran? (Status-Punkt in der Seitenleiste) */
export function useInstanceActivity(id: string) {
  const running = useGameStore((s) => isRunning(s.states[id]));
  const busy = useInstanceTasks(id).length > 0;
  return { running, busy };
}

export function usePageTitle(): ReactNode {
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const instId = path.startsWith("/instances/") ? decodeURIComponent(path.split("/")[2] ?? "") : "";
  const { data: inst } = useInstance(instId);
  const serverId = path.startsWith("/servers/") ? decodeURIComponent(path.split("/")[2] ?? "") : "";
  const { data: server } = useServer(serverId);
  const crumb = (parent: string, child: ReactNode, muted?: boolean) => (
    <>
      <span className="vl-crumb font-medium text-muted">{parent}</span>
      <ChevronRight size={13} className="shrink-0 text-dim" />
      <span className={muted ? "text-muted" : "truncate"}>{child}</span>
    </>
  );
  if (path === "/") return t("nav.home");
  if (path === "/instances") return t("nav.instances");
  if (path === "/modsets") return crumb(t("nav.instances"), t("nav.modsets"));
  if (path === "/servers") return t("nav.servers");
  if (serverId) return crumb(t("nav.servers"), server?.name ?? serverId);
  if (instId) return crumb(t("nav.instances"), inst?.name ?? instId);
  if (path.startsWith("/discover")) return t("nav.discover");
  if (path.startsWith("/project/")) return crumb(t("nav.discover"), t("rail.project"), true);
  if (path === "/accounts") return t("nav.accounts");
  if (path === "/stats") return t("stats.title");
  if (path === "/skins") return t("nav.skins");
  if (path === "/screenshots") return t("nav.screenshots");
  if (path === "/social") return t("nav.social");
  if (path === "/cosmetics") return t("nav.cosmetics");
  if (path === "/cosmetics/creator") return crumb(t("nav.cosmetics"), t("cos.creator"));
  return null;
}

export { RunningGames } from "./RunningSessions";
