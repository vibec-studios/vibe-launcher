// Mock: Client-Packs (NoRisk, NoRisk Mini, Essential). Nur für VITE_MOCK=1.
// „H&H Armors“ hat NoRisk Mini. NoRisk-Ausfall simulieren:
// `window.__vlMockNoriskDown = true` und den Client-Tab neu öffnen.
import type { ClientPackInstall, ClientPackOffer, ClientPacksOverview, LoaderKind } from "@/lib/types";
import { instances } from "./core";
import { fakeTask, mockEmit, type Handlers } from "./util";

const NORISK_FABRIC = ["26.3", "26.2", "26.1.2", "26.1.1", "26.1", "1.21.11", "1.21.10", "1.21.9", "1.21.8", "1.21.7", "1.21.5", "1.21.4", "1.21.1", "1.21", "1.20.1", "1.19.4", "1.19.2", "1.18.2", "1.16.5"];
const NORISK: Record<string, string[]> = {
  fabric: NORISK_FABRIC,
  forge: [...NORISK_FABRIC.filter((v) => v !== "26.3"), "1.12.2", "1.8.9", "1.7.10"],
  neoforge: NORISK_FABRIC.filter((v) => !["26.3", "1.20.1", "1.19.4", "1.19.2", "1.18.2", "1.16.5"].includes(v)),
};
const ESSENTIAL: Record<string, string[]> = {
  fabric: ["26.3", "26.2", "26.1.2", "1.21.11", "1.21.10", "1.21.8", "1.21.7", "1.21.5", "1.21.4", "1.21.1", "1.20.1"],
  forge: ["1.20.1", "1.12.2", "1.8.9"],
  neoforge: ["26.3", "26.2", "26.1.2", "1.21.11", "1.21.8", "1.21.4", "1.21.1"],
};
const NORISK_LATEST = "26.4.3940900";

type Def = Pick<ClientPackOffer, "id" | "category" | "source" | "group" | "vendor" | "homepage" | "projects"> & { loaders: LoaderKind[]; versions: (l: string) => string[] };
const DEFS: Def[] = [
  { id: "norisk", category: "community", source: "norisk", group: "client", vendor: "NoRisk", homepage: "https://norisk.gg", projects: [], loaders: ["fabric", "forge", "neoforge"], versions: (l) => NORISK[l] ?? [] },
  { id: "norisk-mini", category: "community", source: "norisk", group: "client", vendor: "NoRisk", homepage: "https://norisk.gg", projects: [], loaders: ["fabric", "forge", "neoforge"], versions: (l) => NORISK[l] ?? [] },
  {
    id: "essential",
    category: "community",
    source: "modrinth",
    group: "client",
    vendor: "Essential (Spark Universe)",
    homepage: "https://modrinth.com/mod/essential",
    projects: ["k2ZPuTBm"],
    loaders: ["fabric", "forge", "neoforge"],
    versions: (l) => ESSENTIAL[l] ?? [],
  },
];

const installed = new Map<string, Map<string, ClientPackInstall>>([
  ["hh-armors", new Map([["norisk-mini", mk("26.4.3940900", "1.21.11", "fabric", ["nrc-mini-26.4.3940900+fabric.1.21.11.jar"])]])],
]);

function mk(version: string | null, mc: string, loader: string, files: string[]): ClientPackInstall {
  return { version, files, mc_version: mc, loader, installed_at: Date.now() - 86400_000 * 3, disabled_by_user: false, missing: false, mismatch: false };
}

const noriskDown = () => !!(window as unknown as { __vlMockNoriskDown?: boolean }).__vlMockNoriskDown;

function overview(mc: string, loader: LoaderKind, instanceId: string | null): ClientPacksOverview {
  const mine = instanceId ? installed.get(instanceId) : undefined;
  const packs = DEFS.map((d): ClientPackOffer => {
    const inst = mine?.get(d.id) ?? null;
    const o: ClientPackOffer = {
      id: d.id,
      category: d.category,
      source: d.source,
      group: d.group,
      vendor: d.vendor,
      homepage: d.homepage,
      projects: d.projects,
      available: null,
      reason: null,
      error: null,
      mc_versions: [],
      latest_version: null,
      update_available: false,
      installed: inst ? { ...inst, mismatch: inst.mc_version !== mc } : null,
    };
    if (!d.loaders.includes(loader)) return { ...o, available: false, reason: "loader" };
    if (d.source === "norisk" && noriskDown()) {
      return { ...o, reason: "unreachable", error: "NoRisk ist gerade nicht erreichbar (HTTP 503). Du kannst die Mod auf norisk.gg herunterladen." };
    }
    const versions = d.versions(loader);
    o.mc_versions = versions;
    o.available = versions.includes(mc);
    if (!o.available) o.reason = "version";
    if (d.source === "norisk" && inst) o.latest_version = NORISK_LATEST;
    if (inst) o.update_available = (!!o.latest_version && o.latest_version !== inst.version) || !!o.installed?.mismatch;
    return o;
  });
  return { mc_version: mc, loader, vibe_enabled: true, packs };
}

const handlers: Handlers = {
  client_packs_list: ({ instanceId, mcVersion, loader }) => {
    if (instanceId) {
      const i = instances.get(instanceId as string)!;
      return overview(i.mc_version, i.loader.kind, i.id);
    }
    return overview(mcVersion as string, loader as LoaderKind, null);
  },
  client_pack_install: ({ instanceId, packId, replace }) => {
    const id = instanceId as string;
    const pack = packId as string;
    const i = instances.get(id)!;
    const mine = installed.get(id) ?? new Map<string, ClientPackInstall>();
    const rivals = [...mine.keys()].filter((k) => k !== pack && DEFS.find((d) => d.id === k)?.group === "client");
    if (rivals.length && !replace) throw { kind: "invalid", message: `Nur ein Client gleichzeitig: zuerst ${rivals.join(", ")} entfernen.` };
    const version = pack.startsWith("norisk") ? NORISK_LATEST : null;
    const file = pack === "essential" ? `Essential_1-5-2_${i.loader.kind}.jar` : `nrc-${pack === "norisk" ? "standalone" : "mini"}-${NORISK_LATEST}+${i.loader.kind}.${i.mc_version}.jar`;
    return fakeTask("client_pack", `${pack} installieren`, id, 1800, () => {
      for (const r of rivals) mine.delete(r);
      mine.set(pack, mk(version, i.mc_version, i.loader.kind, [file]));
      installed.set(id, mine);
      mockEmit("content://changed", { instance_id: id });
    });
  },
  client_pack_remove: ({ instanceId, packId }) => {
    installed.get(instanceId as string)?.delete(packId as string);
    mockEmit("content://changed", { instance_id: instanceId as string });
    return null;
  },
};

export default handlers;
