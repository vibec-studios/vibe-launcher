import { call } from "./call";
import type * as T from "../types";

export const instancesApi = {
  // ---------------------------------------------------------------- Instanzen
  instancesList: () => call<T.Instance[]>("instances_list"),
  instanceGet: (id: string) => call<T.Instance>("instance_get", { id }),
  instanceCreate: (req: T.CreateInstance) => call<T.Instance>("instance_create", { req }),
  instanceUpdate: (id: string, patch: T.InstancePatch) => call<T.Instance>("instance_update", { id, patch }),
  instanceDelete: (id: string) => call<void>("instance_delete", { id }),
  instanceDuplicate: (id: string, name?: string | null) => call<T.Instance>("instance_duplicate", { id, name: name ?? null }),
  instanceSetIcon: (id: string, path: string | null) => call<T.Instance>("instance_set_icon", { id, path }),
  instanceOpenFolder: (id: string, sub?: string | null) => call<void>("instance_open_folder", { id, sub: sub ?? null }),

  // ---------------------------------------------------------------- Client-Packs
  /** Für eine Instanz (mit Installationsstand) oder eine geplante Instanz (Version + Loader). */
  clientPacksList: (q: { instanceId: string } | { mcVersion: string; loader: T.LoaderKind }) =>
    call<T.ClientPacksOverview>("client_packs_list", { instanceId: null, mcVersion: null, loader: null, ...q }),
  /** Task-ID. `replace`: andere Clients vorher entfernen (nach Bestätigung). */
  clientPackInstall: (instanceId: string, packId: string, replace = false) => call<string>("client_pack_install", { instanceId, packId, replace }),
  clientPackRemove: (instanceId: string, packId: string) => call<void>("client_pack_remove", { instanceId, packId }),
};
