export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Args = Record<string, unknown>;

export interface Route {
  method: Method;
  path: string;
  body?: (a: Args) => unknown;
  text?: (a: Args) => string;
  task?: boolean;
}

const pick =
  (...keys: string[]) =>
  (a: Args) =>
    Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k] ?? null]));

const r = (method: Method, path: string, extra: Omit<Route, "method" | "path"> = {}): Route => ({ method, path, ...extra });

export const ROUTES: Record<string, Route> = {
  server_get: r("GET", "/servers/{id}"),
  server_update: r("PATCH", "/servers/{id}", { body: (a) => a.patch }),
  server_delete: r("DELETE", "/servers/{id}"),
  server_install: r("POST", "/servers/{id}/install", { body: pick("force"), task: true }),
  server_accept_eula: r("POST", "/servers/{id}/eula"),
  server_start: r("POST", "/servers/{id}/start"),
  server_stop: r("POST", "/servers/{id}/stop"),
  server_restart: r("POST", "/servers/{id}/restart"),
  server_kill: r("POST", "/servers/{id}/kill"),
  server_command: r("POST", "/servers/{id}/command", { body: pick("command") }),
  server_log: r("GET", "/servers/{id}/log"),
  server_addresses: r("GET", "/servers/{id}/addresses"),
  server_properties_get: r("GET", "/servers/{id}/properties"),
  server_properties_set: r("PUT", "/servers/{id}/properties", { body: pick("values") }),
  server_properties_raw: r("GET", "/servers/{id}/properties/raw"),
  server_properties_raw_set: r("PUT", "/servers/{id}/properties/raw", { text: (a) => String(a.text ?? "") }),
  server_players: r("GET", "/servers/{id}/players"),
  server_player_action: r("POST", "/servers/{id}/players/{list}", { body: pick("action", "name", "reason") }),
  server_set_whitelist: r("PUT", "/servers/{id}/whitelist", { body: pick("enabled") }),
  server_worlds: r("GET", "/servers/{id}/worlds"),
  server_backups: r("GET", "/servers/{id}/backups"),
  server_backup_create: r("POST", "/servers/{id}/backups", { body: pick("world"), task: true }),
  server_backup_delete: r("DELETE", "/servers/{id}/backups/{name}"),
  server_backup_restore: r("POST", "/servers/{id}/backups/{name}/restore", { task: true }),
  server_tunnel_reset: r("POST", "/servers/{id}/tunnel/reset"),
  server_extras_get: r("GET", "/servers/{id}/extras"),
  server_extras_set: r("PUT", "/servers/{id}/extras", { body: (a) => ({ voice: a.voice ?? undefined, bedrock: a.bedrock ?? undefined }) }),
  server_platform_set_build: r("POST", "/servers/{id}/platform/build", { body: pick("build"), task: true }),
  server_addons: r("GET", "/servers/{id}/addons"),
  server_addon_search: r("GET", "/servers/{id}/addons/search?source={source}&query={query}&sort={sort}&offset={offset}"),
  server_addon_install: r("POST", "/servers/{id}/addons", { body: pick("source", "project", "version") }),
  server_addon_updates: r("GET", "/servers/{id}/addons/updates"),
  server_addon_update: r("POST", "/servers/{id}/addons/update", { body: pick("files") }),
  server_addon_set_enabled: r("PATCH", "/servers/{id}/addons/{file}", { body: pick("enabled") }),
  server_addon_remove: r("DELETE", "/servers/{id}/addons/{file}"),
  task_cancel: r("POST", "/tasks/{id}/cancel"),
};

export function fillPath(template: string, a: Args): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(a[k] == null ? "" : String(a[k])));
}

export function matchPath(template: string, path: string): Args | null {
  const [tp, tq] = template.split("?");
  const [pp, pq] = path.split("?");
  const names: string[] = [];
  const re = new RegExp(`^${tp.replace(/\{(\w+)\}/g, (_, k: string) => (names.push(k), "([^/]+)"))}$`);
  const m = re.exec(pp);
  if (!m) return null;
  const out: Args = {};
  names.forEach((n, i) => (out[n] = decodeURIComponent(m[i + 1])));
  if (tq) {
    const want = new URLSearchParams(tq);
    const got = new URLSearchParams(pq ?? "");
    want.forEach((v, k) => {
      const name = /^\{(\w+)\}$/.exec(v)?.[1];
      if (name) out[name] = got.get(k) ?? "";
    });
  }
  return out;
}

export function findRoute(method: string, path: string): { cmd: string; args: Args } | null {
  for (const [cmd, route] of Object.entries(ROUTES)) {
    if (route.method !== method) continue;
    const args = matchPath(route.path, path);
    if (args) return { cmd, args };
  }
  return null;
}
