import type { AgentSocket, RequestOptions, Transport } from "./transport";
import type * as T from "./types";

const enc = encodeURIComponent;

export type ImportFormat = "mrpack" | "zip" | "vlpack";

export class AgentApi {
  constructor(readonly transport: Transport) {}

  private r<R>(method: string, path: string, opts?: RequestOptions) {
    return this.transport.request<R>(method, path, opts);
  }

  socket(): AgentSocket {
    return this.transport.openSocket();
  }

  info = () => this.r<T.AgentInfo>("GET", "/info");
  pair = (code: string, clientName: string) =>
    this.r<T.PairResult>("POST", "/pair", { body: { client_name: clientName, client_kind: "panel", code } });
  me = () => this.r<T.Me>("GET", "/me");
  resources = () => this.r<T.Resources>("GET", "/agent/resources");
  settings = () => this.r<T.AgentSettings>("GET", "/agent/settings");
  updateSettings = (patch: { name?: string; gateway_enabled?: boolean }) => this.r<T.AgentSettings>("PATCH", "/agent/settings", { body: patch });
  audit = (limit = 100) => this.r<T.AuditEntry[]>("GET", "/agent/audit", { query: { limit } });
  update = () => this.r<{ current: string; latest: string; available: boolean; notes_url?: string }>("GET", "/agent/update");
  runUpdate = () => this.r<{ task_id: string }>("POST", "/agent/update");
  gateway = () => this.r<T.GatewayStatus>("GET", "/agent/gateway");
  gatewayLink = () => this.r<T.GatewayStatus & { code?: string; expires_at?: number }>("POST", "/agent/gateway/link");
  gatewayUnlink = () => this.r<void>("DELETE", "/agent/gateway/link");
  relay = () => this.r<T.RelayIdentityInfo>("GET", "/agent/relay");

  users = () => this.r<T.User[]>("GET", "/users");
  invite = (role: T.Role, servers?: string[]) => this.r<T.Invite>("POST", "/users/invite", { body: { role, servers } });
  updateUser = (id: string, patch: { role?: T.Role; servers?: string[]; name?: string }) => this.r<T.User>("PATCH", `/users/${enc(id)}`, { body: patch });
  removeUser = (id: string) => this.r<void>("DELETE", `/users/${enc(id)}`);
  pairCode = (role?: T.Role) => this.r<T.Invite>("POST", "/pair/codes", { body: { role } });
  rotateToken = () => this.r<{ token: string; token_id: string }>("POST", "/tokens/rotate");

  servers = () => this.r<T.ServerView[]>("GET", "/servers");
  server = (id: string) => this.r<T.ServerView>("GET", `/servers/${enc(id)}`);
  createServer = (req: T.ServerCreate) => this.r<T.ServerCreated>("POST", "/servers", { body: req });
  patchServer = (id: string, patch: T.ServerPatch) => this.r<T.Server>("PATCH", `/servers/${enc(id)}`, { body: patch });
  deleteServer = (id: string) => this.r<void>("DELETE", `/servers/${enc(id)}`);
  install = (id: string, force = false) => this.r<{ task_id: string }>("POST", `/servers/${enc(id)}/install`, { body: { force } });
  acceptEula = (id: string) => this.r<T.Server>("POST", `/servers/${enc(id)}/eula`);
  power = (id: string, action: "start" | "stop" | "restart" | "kill") => this.r<void>("POST", `/servers/${enc(id)}/${action}`);
  command = (id: string, command: string) => this.r<void>("POST", `/servers/${enc(id)}/command`, { body: { command } });
  status = (id: string) => this.r<T.ServerStatus>("GET", `/servers/${enc(id)}/status`);
  log = (id: string) => this.r<T.LogLine[]>("GET", `/servers/${enc(id)}/log`);
  addresses = (id: string) => this.r<T.ServerAddresses>("GET", `/servers/${enc(id)}/addresses`);

  properties = (id: string) => this.r<[string, string][]>("GET", `/servers/${enc(id)}/properties`);
  setProperties = (id: string, values: Record<string, string>) => this.r<[string, string][]>("PUT", `/servers/${enc(id)}/properties`, { body: { values } });
  propertiesRaw = (id: string) => this.r<string>("GET", `/servers/${enc(id)}/properties/raw`, { as: "text" });
  setPropertiesRaw = (id: string, text: string) => this.r<void>("PUT", `/servers/${enc(id)}/properties/raw`, { raw: text, contentType: "text/plain" });

  players = (id: string) => this.r<T.ServerPlayers>("GET", `/servers/${enc(id)}/players`);
  playerAction = (id: string, list: T.ServerPlayerList, action: "add" | "remove", name: string, reason?: string) =>
    this.r<T.ServerPlayers>("POST", `/servers/${enc(id)}/players/${list}`, { body: { action, name, reason } });
  setWhitelist = (id: string, enabled: boolean) => this.r<T.ServerPlayers>("PUT", `/servers/${enc(id)}/whitelist`, { body: { enabled } });

  worlds = (id: string) => this.r<T.ServerWorld[]>("GET", `/servers/${enc(id)}/worlds`);
  backups = (id: string) => this.r<T.ServerBackup[]>("GET", `/servers/${enc(id)}/backups`);
  createBackup = (id: string, world?: string) => this.r<{ task_id: string }>("POST", `/servers/${enc(id)}/backups`, { body: { world } });
  deleteBackup = (id: string, name: string) => this.r<void>("DELETE", `/servers/${enc(id)}/backups/${enc(name)}`);
  restoreBackup = (id: string, name: string) => this.r<{ task_id: string }>("POST", `/servers/${enc(id)}/backups/${enc(name)}/restore`);
  downloadBackup = (id: string, name: string) => this.r<Blob>("GET", `/servers/${enc(id)}/backups/${enc(name)}/download`, { as: "blob" });

  files = (id: string, path: string) => this.r<T.FileListing>("GET", `/servers/${enc(id)}/files`, { query: { path } });
  fileBlob = (id: string, path: string) => this.r<Blob>("GET", `/servers/${enc(id)}/files/content`, { query: { path }, as: "blob" });
  fileText = (id: string, path: string) => this.r<string>("GET", `/servers/${enc(id)}/files/content`, { query: { path }, as: "text" });
  writeFile = (id: string, path: string, data: Blob | string, onProgress?: (f: number) => void) =>
    this.r<void>("PUT", `/servers/${enc(id)}/files/content`, { query: { path }, raw: data, onProgress });
  mkdir = (id: string, path: string) => this.r<void>("POST", `/servers/${enc(id)}/files/mkdir`, { body: { path } });
  rename = (id: string, from: string, to: string) => this.r<void>("POST", `/servers/${enc(id)}/files/rename`, { body: { from, to } });
  deleteFile = (id: string, path: string) => this.r<void>("DELETE", `/servers/${enc(id)}/files`, { query: { path } });

  addons = (id: string) => this.r<T.AddonList>("GET", `/servers/${enc(id)}/addons`);
  searchAddons = (id: string, source: T.AddonSource, query: string, offset = 0, signal?: AbortSignal) =>
    this.r<T.AddonSearch>("GET", `/servers/${enc(id)}/addons/search`, { query: { source, query, sort: "relevance", offset }, signal });
  installAddon = (id: string, source: T.AddonSource, project: string) => this.r<string[]>("POST", `/servers/${enc(id)}/addons`, { body: { source, project } });
  uploadAddon = (id: string, file: File, onProgress?: (f: number) => void) =>
    this.r<string>("POST", `/servers/${enc(id)}/addons/upload`, { query: { filename: file.name }, raw: file, onProgress });
  setAddonEnabled = (id: string, file: string, enabled: boolean) => this.r<string>("PATCH", `/servers/${enc(id)}/addons/${enc(file)}`, { body: { enabled } });
  removeAddon = (id: string, file: string) => this.r<void>("DELETE", `/servers/${enc(id)}/addons/${enc(file)}`);

  importPack = (file: File, format: ImportFormat, opts: { name?: string; server?: string }, onProgress?: (f: number) => void) =>
    this.r<T.ServerCreated>("POST", "/servers/import", { query: { format, name: opts.name, server: opts.server }, raw: file, onProgress });

  mcVersions = () => this.r<T.McVersion[]>("GET", "/catalog/minecraft");
  loaderVersions = async (kind: T.LoaderKind, mc: string) => {
    const list = await this.r<(string | { version: string; stable?: boolean })[]>("GET", `/catalog/loaders/${kind}`, { query: { mc } });
    return list.map((v) => (typeof v === "string" ? v : v.version));
  };
  platformVersions = (kind: T.PlatformKind) => this.r<T.PlatformVersion[]>("GET", `/catalog/platforms/${kind}`);

  tunnel = (id: string) => this.r<T.TunnelStatus | null>("GET", `/servers/${enc(id)}/tunnel`);
  resetTunnel = (id: string) => this.r<void>("POST", `/servers/${enc(id)}/tunnel/reset`);

  tasks = () => this.r<T.TaskInfo[]>("GET", "/tasks");
  cancelTask = (id: string) => this.r<void>("POST", `/tasks/${enc(id)}/cancel`);
}
