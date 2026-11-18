// Routen (Hash-History, code-basiert). Seiten lesen Parameter über `getRouteApi("/pfad")`,
// damit es keine Import-Zyklen gibt:   const route = getRouteApi("/instances/$id"); route.useSearch()
import { createHashHistory, createRootRoute, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
import { Shell } from "./Shell";
import { HomePage } from "@/features/home/HomePage";
import { InstancesPage } from "@/features/instances/InstancesPage";
import { InstancePage } from "@/features/instances/InstancePage";
import { DiscoverPage } from "@/features/discover/DiscoverPage";
import { ProjectPage } from "@/features/discover/ProjectPage";
import { AccountsPage } from "@/features/accounts/AccountsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { SkinsPage } from "@/features/skins/SkinsPage";
import { ScreenshotsPage } from "@/features/screenshots/ScreenshotsPage";
import { StatsPage } from "@/features/stats/StatsPage";
import { ServersPage } from "@/features/servers/ServersPage";
import { ServerPage } from "@/features/servers/ServerPage";
import { SocialPage } from "@/features/social/SocialPage";
import type { ProjectType, Source } from "@/lib/types";

export type InstanceTab = "content" | "resourcepacks" | "shaders" | "worlds" | "servers" | "backups" | "logs" | "configs" | "settings";
const instanceTabs: InstanceTab[] = ["content", "resourcepacks", "shaders", "worlds", "servers", "backups", "logs", "configs", "settings"];
export type ServerTab = "console" | "settings" | "players" | "worlds" | "connection";
const serverTabs: ServerTab[] = ["console", "settings", "players", "worlds", "connection"];
const projectTypes: ProjectType[] = ["mod", "modpack", "resourcepack", "shader", "datapack"];

export interface DiscoverSearch {
  source?: Source;
  type?: ProjectType;
  q?: string;
  /** Ziel-Instanz: Installieren geht direkt in diese Instanz, Filter passen sich an */
  instance?: string;
}

export interface ProjectSearch {
  instance?: string;
}

const rootRoute = createRootRoute({ component: Shell });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });

const instancesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/instances", component: InstancesPage });

const instanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/instances/$id",
  component: InstancePage,
  validateSearch: (s: Record<string, unknown>): { tab: InstanceTab } => ({
    tab: instanceTabs.includes(s.tab as InstanceTab) ? (s.tab as InstanceTab) : "content",
  }),
});

const discoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/discover",
  component: DiscoverPage,
  validateSearch: (s: Record<string, unknown>): DiscoverSearch => ({
    source:
      s.source === "curseforge" ? "curseforge" : s.source === "modrinth" ? "modrinth" : typeof s.source === "string" && /^store:[\w-]+$/.test(s.source) ? (s.source as Source) : undefined,
    type: projectTypes.includes(s.type as ProjectType) ? (s.type as ProjectType) : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
    instance: typeof s.instance === "string" ? s.instance : undefined,
  }),
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/project/$source/$id",
  component: ProjectPage,
  validateSearch: (s: Record<string, unknown>): ProjectSearch => ({
    instance: typeof s.instance === "string" ? s.instance : undefined,
  }),
});

const accountsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/accounts", component: AccountsPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });
const skinsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/skins", component: SkinsPage });
const statsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/stats", component: StatsPage });
const screenshotsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/screenshots",
  component: ScreenshotsPage,
  validateSearch: (s: Record<string, unknown>): { instance?: string } => ({ instance: typeof s.instance === "string" ? s.instance : undefined }),
});

const serversRoute = createRoute({ getParentRoute: () => rootRoute, path: "/servers", component: ServersPage });
const serverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/servers/$id",
  component: ServerPage,
  validateSearch: (s: Record<string, unknown>): { tab: ServerTab } => ({
    tab: serverTabs.includes(s.tab as ServerTab) ? (s.tab as ServerTab) : "console",
  }),
});

const socialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/social",
  component: SocialPage,
  validateSearch: (s: Record<string, unknown>): { chat?: string } => ({ chat: typeof s.chat === "string" && s.chat.length <= 64 ? s.chat : undefined }),
});

// Cosmetics (three.js nur bei Bedarf laden)
const cosmeticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cosmetics",
  component: lazyRouteComponent(() => import("@/features/cosmetics/CosmeticsPage"), "CosmeticsPage"),
});
const creatorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cosmetics/creator",
  component: lazyRouteComponent(() => import("@/features/cosmetics/CreatorPage"), "CreatorPage"),
});

const routeTree = rootRoute.addChildren([
  cosmeticsRoute,
  creatorRoute,
  socialRoute,
  homeRoute,
  instancesRoute,
  instanceRoute,
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
