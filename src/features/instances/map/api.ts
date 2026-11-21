import { invoke } from "@tauri-apps/api/core";

export type MapSourceKind = "xaero" | "journeymap";

export interface MapSource {
  id: string;
  kind: MapSourceKind;
  world: string;
  multiplayer: boolean;
  name: string;
  servers: string[];
  dimensions: string[];
  modified: number | null;
}

export interface MapWaypoint {
  name: string;
  initials: string;
  x: number;
  y: number | null;
  z: number;
  color: string;
  death: boolean;
}

export interface MapOverview {
  layer: string;
  cave: boolean;
  regions: [number, number][];
  truncated: boolean;
  latest: [number, number] | null;
  waypoints: MapWaypoint[];
}

export interface MapTile {
  png: string;
  lod: number;
}

export const REGION = 512;
export const LODS = [1, 2, 4, 8] as const;
export const VANILLA_DIMENSIONS = ["minecraft:overworld", "minecraft:the_nether", "minecraft:the_end"] as const;
export const XAERO_WORLD_MAP = { source: "modrinth" as const, id: "NcUtCpym", title: "Xaero's World Map" };

export const worldMapApi = {
  sources: (instanceId: string) => invoke<MapSource[]>("world_map_sources", { instanceId }),
  overview: (instanceId: string, source: string, dimension: string) =>
    invoke<MapOverview | null>("world_map_overview", { instanceId, source, dimension }),
  waypoints: (instanceId: string, world: string, dimension: string) =>
    invoke<MapWaypoint[]>("world_map_waypoints", { instanceId, world, dimension }),
  tile: (instanceId: string, source: string, layer: string, x: number, z: number, lod: number, session: string) =>
    invoke<MapTile | null>("world_map_tile", { instanceId, source, layer, x, z, lod, session }),
  cancel: (session: string) => invoke<void>("world_map_cancel", { session }),
};

export function sourcesForWorld(sources: MapSource[] | undefined, folder: string) {
  return (sources ?? []).filter((source) => !source.multiplayer && source.world === folder);
}

export function sourcesForServer(sources: MapSource[] | undefined, ip: string) {
  return (sources ?? []).filter((source) => source.multiplayer && source.servers.includes(ip));
}
