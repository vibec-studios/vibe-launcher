// Routen (Hash-History, code-basiert). Seiten lesen Parameter über `getRouteApi("/pfad")`,
// damit es keine Import-Zyklen gibt:   const route = getRouteApi("/instances/$id"); route.useSearch()
import { createHashHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Shell } from "./Shell";
import { HomePage } from "@/features/home/HomePage";
import { InstancesPage } from "@/features/instances/InstancesPage";
import { InstancePage } from "@/features/instances/InstancePage";
import { DiscoverPage } from "@/features/discover/DiscoverPage";
import { ProjectPage } from "@/features/discover/ProjectPage";
import { AccountsPage } from "@/features/accounts/AccountsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import type { ProjectType, Source } from "@/lib/types";

export type InstanceTab = "content" | "resourcepacks" | "shaders" | "worlds" | "logs" | "settings";
const instanceTabs: InstanceTab[] = ["content", "resourcepacks", "shaders", "worlds", "logs", "settings"];
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
    source: s.source === "curseforge" ? "curseforge" : s.source === "modrinth" ? "modrinth" : undefined,
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

const routeTree = rootRoute.addChildren([
  homeRoute,
  instancesRoute,
  instanceRoute,
  discoverRoute,
  projectRoute,
  accountsRoute,
  settingsRoute,
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
