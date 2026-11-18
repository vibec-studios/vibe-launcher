// Tauri-Commands des Vibey Clients (src-tauri/src/vibey_client/commands.rs) und REST-Aufrufe der Cosmetics-API
// über den VibeClient der Vibe-Dienste (HTTP läuft in Rust, Token im Schlüsselbund).
import { invoke } from "@tauri-apps/api/core";
import { requireClient, vibeClient } from "@/features/social/service";
import type { BlockbenchStatus, Catalog, ClientRelease, ClientStatus, CosmeticsMe, Loadout, LoadoutSlots, Submission, VibeyInstance } from "./types";

export const vapi = {
  clientLatest: (force = false) => invoke<ClientRelease>("vibey_client_latest", { force }),
  clientStatus: (instanceId: string) => invoke<ClientStatus>("vibey_client_status", { instanceId }),
  /** An: Task-ID der Installation; aus: null */
  clientSet: (instanceId: string, enabled: boolean) => invoke<string | null>("vibey_client_set", { instanceId, enabled }),
  clientCreateInstance: () => invoke<string>("vibey_client_create_instance"),
  clientInstances: () => invoke<VibeyInstance[]>("vibey_client_instances"),
  asset: (hash: string) => invoke<string>("vibey_cosmetic_asset", { hash }),
  thumbnail: (url: string, token?: string | null) => invoke<string | null>("vibey_cosmetic_thumbnail", { url, token: token ?? null }),
  bundleRead: (path: string) => invoke<string>("vibey_bundle_read", { path }),
  submissionUpload: (token: string, path: string, name: string, description: string, thumbnail: string | null) =>
    invoke<{ submission: Submission }>("vibey_submission_upload", { token, path, name, description, thumbnail }),
  blockbenchStatus: () => invoke<BlockbenchStatus>("vibey_blockbench_status"),
  blockbenchInstallPlugin: () => invoke<BlockbenchStatus>("vibey_blockbench_install_plugin"),
  blockbenchOpen: () => invoke<void>("vibey_blockbench_open"),
  blockbenchRevealPlugin: () => invoke<void>("vibey_blockbench_reveal_plugin"),
};

const enc = encodeURIComponent;

/** REST der Cosmetics-API (VIBE-API-2 §3/§4 + bestehende Katalog-/Loadout-Routen). */
export const capi = {
  catalog: () => requireClient().request<Catalog>("GET", "/api/v1/cosmetics/catalog", { auth: false }),
  me: () => requireClient().request<CosmeticsMe>("GET", "/api/v1/cosmetics/me"),
  setLoadout: (body: { slots?: LoadoutSlots; emoteWheel?: (string | null)[] }) => requireClient().request<Loadout>("PUT", "/api/v1/cosmetics/loadout", { body }),
  submissions: async () => {
    const r = await requireClient().request<Submission[] | { submissions: Submission[] }>("GET", "/api/v1/cosmetics/submissions");
    return Array.isArray(r) ? r : (r?.submissions ?? []);
  },
  submissionAsset: (id: string) => requireClient().request<unknown>("GET", `/api/v1/cosmetics/submissions/${enc(id)}/asset`),
  withdraw: (id: string) => requireClient().request<void>("DELETE", `/api/v1/cosmetics/submissions/${enc(id)}`),
  /** Gültiges Access-Token für Multipart-Uploads (laufen direkt in Rust) */
  token: async () => {
    const t = await vibeClient()?.accessToken();
    if (!t) throw new Error("Nicht bei Vibe angemeldet");
    return t;
  },
};

export const readPng = (path: string) => invoke<{ dataUrl: string; width: number; height: number }>("vibey_png_read", { path });
