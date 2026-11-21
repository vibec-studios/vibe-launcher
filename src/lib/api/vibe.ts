import { call } from "./call";
import type * as T from "../types";

export const vibeApi = {
  // ---------------------------------------------------------------- Vibe-Dienste (Netzwerk nur, wenn settings.vibe.enabled)
  vibeStatus: () => call<T.VibeStatus>("vibe_status"),
  /** Ankündigungen (Banner). Nur mit Hauptschalter; Fehler zeigt der Aufrufer nicht an */
  vibeAnnouncements: (lang: string) => call<T.Announcement[]>("vibe_announcements", { lang }),
  vibeTokensGet: () => call<T.VibeTokens | null>("vibe_tokens_get"),
  vibeTokensSet: (tokens: T.VibeTokens | null) => call<void>("vibe_tokens_set", { tokens }),
  /** Mojang-Join mit dem Token des aktiven Accounts (bleibt in Rust) – liefert den Minecraft-Namen */
  vibeMojangJoin: (serverId: string) => call<{ name: string; uuid: string }>("vibe_mojang_join", { serverId }),
  vibeHttp: (request: T.VibeHttpRequest) => call<T.VibeHttpResponse>("vibe_http", { request }),
  vibeWsOpen: (id: string, url: string) => call<void>("vibe_ws_open", { id, url }),
  vibeWsSend: (id: string, data: string) => call<void>("vibe_ws_send", { id, data }),
  vibeWsClose: (id: string, code?: number, reason?: string) => call<void>("vibe_ws_close", { id, code: code ?? null, reason: reason ?? null }),
  /** Exportiert + lädt hoch, liefert das Pack (JSON des Backends) */
  vibePackShare: (instanceId: string, token: string, options: T.VibeShareOptions) => call<unknown>("vibe_pack_share", { instanceId, token, options }),
  vibePackLink: (instanceId: string) => call<T.VibeShareLink | null>("vibe_pack_link", { instanceId }),
  /** Gibt Task-ID zurück */
  vibePackInstall: (code: string, versionId?: string | null, token?: string | null) =>
    call<string>("vibe_pack_install", { code, versionId: versionId ?? null, token: token ?? null }),
  vibeScreenshotUpload: (path: string, visibility: string, token: string) => call<unknown>("vibe_screenshot_upload", { path, visibility, token }),
  vibeImage: (url: string, token?: string | null) => call<string>("vibe_image", { url, token: token ?? null }),
  vibeCloudManifests: (instanceIds: string[]) => call<{ id: string; manifest: unknown }[]>("vibe_cloud_manifests", { instanceIds }),
  /** Gibt Task-ID zurück */
  vibeCloudRestoreInstance: (manifest: unknown) => call<string>("vibe_cloud_restore_instance", { manifest }),
};
