import { call } from "./call";
import type * as T from "../types";

export const gameApi = {
  // ---------------------------------------------------------------- Spiel
  gameVersions: (refresh = false) => call<T.McVersion[]>("game_versions", { refresh }),
  loaderGameVersions: (loader: T.LoaderKind) => call<string[]>("loader_game_versions", { loader }),
  loaderVersions: (loader: T.LoaderKind, mcVersion: string) => call<T.LoaderVersion[]>("loader_versions", { loader, mcVersion }),
  instanceInstall: (id: string, force = false) => call<string>("instance_install", { id, force }),
  /** `world`: Ordnername unter saves/ – startet per Quick Play direkt in diese Welt (ab Minecraft 1.20). */
  /** `server`: Adresse (host[:port]) – direkt auf diesen Server (Quick Play ab 1.20, sonst --server/--port). */
  instanceLaunch: (id: string, accountId?: string | null, world?: string | null, server?: string | null, offline?: boolean, afk?: boolean) =>
    call<string>("instance_launch", { id, accountId: accountId ?? null, world: world ?? null, server: server ?? null, offline: offline ?? null, afk: afk ?? null }),
  instanceKill: (id: string, runId?: string | null) => call<void>("instance_kill", { id, runId: runId ?? null }),
  consoleOpen: (runId?: string | null) => call<void>("console_open", { runId: runId ?? null }),
  gameStates: () => call<T.GameState[]>("game_states"),
  gameResources: () => call<T.RunResources[]>("game_resources"),
  instanceLogSession: (id: string, runId?: string | null) => call<T.LogLine[]>("instance_log_session", { id, runId: runId ?? null }),
  instanceLogFiles: (id: string) => call<T.LogFile[]>("instance_log_files", { id }),
  instanceLogRead: (id: string, name: string) => call<string>("instance_log_read", { id, name }),
  mclogsUpload: (content: string) => call<T.MclogsResult>("mclogs_upload", { content }),
  mclogsPreview: (content: string) => call<string>("mclogs_preview", { content }),
  javaList: () => call<T.JavaInstall[]>("java_list"),
  javaTest: (path: string) => call<T.JavaInstall>("java_test", { path }),
  javaInstall: (major: number) => call<string>("java_install", { major }),
};
