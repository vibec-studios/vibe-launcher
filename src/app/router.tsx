// Routen (Hash-History, code-basiert). Seiten lesen Parameter über `getRouteApi("/pfad")`,
// damit es keine Import-Zyklen gibt:   const route = getRouteApi("/instances/$id"); route.useSearch()
import { createHashHistory, createRootRoute, createRoute, createRouter, lazyRouteComponent, redirect } from "@tanstack/react-router";
import { Shell } from "./Shell";
import { HomePage } from "@/features/home/HomePage";
import { isSettingsTab, openSettings, type SettingsTab } from "@/features/settings/store";
import type { ProjectType, Source } from "@/lib/types";

export type InstanceTab = "content" | "resourcepacks" | "shaders" | "worlds" | "servers" | "backups" | "logs" | "files" | "settings";
const instanceTabs: InstanceTab[] = ["content", "resourcepacks", "shaders", "worlds", "servers", "backups", "logs", "files", "settings"];
/** Frühere Tab-Werte (alte Deep-Links) -> heutiger Tab */
const instanceTabAliases: Record<string, InstanceTab> = { configs: "files" };
export type ServerTab = "console" | "settings" | "players" | "addons" | "worlds" | "files" | "connection";
const serverTabs: ServerTab[] = ["console", "settings", "players", "addons", "worlds", "files", "connection"];
const projectTypes: ProjectType[] = ["mod", "modpack", "resourcepack", "shader", "datapack"];

export interface DiscoverSearch {
  source?: Source;
  type?: ProjectType;
  q?: string;
  /** Ziel-Instanz: Installieren geht direkt in diese Instanz, Filter passen sich an */
  instance?: string;
  /** Geöffnetes Projekt-Overlay: `quelle:id` */
  p?: string;
  server?: string;
}

export interface ProjectSearch {
  instance?: string;
}

const rootRoute = createRootRoute({ component: Shell });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });

const instancesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/instances", component: lazyRouteComponent(() => import("@/features/instances/InstancesPage"), "InstancesPage") });

const instanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/instances/$id",
  component: lazyRouteComponent(() => import("@/features/instances/InstancePage"), "InstancePage"),
  validateSearch: (s: Record<string, unknown>): { tab: InstanceTab } => ({
    tab: instanceTabs.includes(s.tab as InstanceTab)
      ? (s.tab as InstanceTab)
      : typeof s.tab === "string" && instanceTabAliases[s.tab]
        ? instanceTabAliases[s.tab]
        : "content",
  }),
});

const discoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/discover",
  component: lazyRouteComponent(() => import("@/features/discover/DiscoverPage"), "DiscoverPage"),
  validateSearch: (s: Record<string, unknown>): DiscoverSearch => ({
    source:
      s.source === "curseforge" ? "curseforge" : s.source === "modrinth" ? "modrinth" : typeof s.source === "string" && /^store:[\w-]+$/.test(s.source) ? (s.source as Source) : undefined,
    type: projectTypes.includes(s.type as ProjectType) ? (s.type as ProjectType) : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
    instance: typeof s.instance === "string" ? s.instance : undefined,
    p: typeof s.p === "string" && s.p.length <= 200 ? s.p : undefined,
    server: typeof s.server === "string" && s.server.length <= 200 ? s.server : undefined,
  }),
});

// Frühere Projektseite: öffnet heute das Overlay über „Entdecken“ (Direktlinks und alte Verweise bleiben gültig)
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/project/$source/$id",
  validateSearch: (s: Record<string, unknown>): ProjectSearch => ({
    instance: typeof s.instance === "string" ? s.instance : undefined,
  }),
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: "/discover", search: discoverSearchFor(decodeURIComponent(params.source) as Source, params.id, search.instance), replace: true });
  },
});

/** Search-Params für „Projekt über Entdecken öffnen“ (von überall: Instanz, Startseite, alte Links). */
export function discoverSearchFor(source: Source, id: string, instance?: string, type?: ProjectType): DiscoverSearch {
  return {
    source: source === "modrinth" ? undefined : source,
    type: type && type !== "mod" ? type : undefined,
    instance,
    p: `${source}:${id}`,
  };
}

// Mod-Sets (Bibliothek → Mod-Sets): Übersicht, `?set=<id>` öffnet den Editor (`add`: Ansicht „Hinzufügen“)
export interface ModSetsSearch {
  set?: string;
  add?: "search" | "paste" | "instance";
}
const modsetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/modsets",
  component: lazyRouteComponent(() => import("@/features/modsets/ModSetsPage"), "ModSetsPage"),
  validateSearch: (s: Record<string, unknown>): ModSetsSearch => ({
    set: typeof s.set === "string" && s.set.length <= 64 ? s.set : undefined,
    add: s.add === "paste" || s.add === "instance" || s.add === "search" ? s.add : undefined,
  }),
});

const accountsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/accounts", component: lazyRouteComponent(() => import("@/features/accounts/AccountsPage"), "AccountsPage") });
// Einstellungen sind ein Popup: `/settings?tab=…` öffnet es und bleibt auf der aktuellen Seite
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  validateSearch: (s: Record<string, unknown>): { tab?: SettingsTab } => ({ tab: isSettingsTab(s.tab) ? s.tab : undefined }),
  beforeLoad: ({ search }) => {
    openSettings(search.tab);
    const prev = router.state.resolvedLocation;
    throw redirect({ href: prev && prev.pathname !== "/settings" ? prev.href : "/", replace: true });
  },
});
const skinsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/skins", component: lazyRouteComponent(() => import("@/features/skins/SkinsPage"), "SkinsPage") });
const statsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/stats", component: lazyRouteComponent(() => import("@/features/stats/StatsPage"), "StatsPage") });
const screenshotsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/screenshots",
  component: lazyRouteComponent(() => import("@/features/screenshots/ScreenshotsPage"), "ScreenshotsPage"),
  validateSearch: (s: Record<string, unknown>): { instance?: string } => ({
    instance: typeof s.instance === "string" ? s.instance : undefined,
  }),
});

const serversRoute = createRoute({ getParentRoute: () => rootRoute, path: "/servers", component: lazyRouteComponent(() => import("@/features/simple/ServersGate"), "ServersPage") });
const serverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/servers/$id",
  component: lazyRouteComponent(() => import("@/features/simple/ServersGate"), "ServerPage"),
  validateSearch: (s: Record<string, unknown>): { tab: ServerTab } => ({
    tab: serverTabs.includes(s.tab as ServerTab) ? (s.tab as ServerTab) : "console",
  }),
});

const socialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/social",
  component: lazyRouteComponent(() => import("@/features/social/SocialPage"), "SocialPage"),
  validateSearch: (s: Record<string, unknown>): { chat?: string; view?: "servers" } => ({
    chat: typeof s.chat === "string" && s.chat.length <= 64 ? s.chat : undefined,
    view: s.view === "servers" ? "servers" : undefined,
  }),
});

const retiredRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cosmetics/$",
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});

const routeTree = rootRoute.addChildren([
  retiredRoute,
  socialRoute,
  homeRoute,
  instancesRoute,
  instanceRoute,
  modsetsRoute,
  serversRoute,
  serverRoute,
  discoverRoute,
  projectRoute,
  accountsRoute,
  settingsRoute,
  skinsRoute,
  statsRoute,
  screenshotsRoute,
]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: "intent",
  // Kein Scroll-Restore des Fensters – Seiten scrollen in eigenen Containern
  scrollRestoration: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
