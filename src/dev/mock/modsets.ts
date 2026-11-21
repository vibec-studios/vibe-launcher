// Mock: Mod-Sets (instanzübergreifende Wunschlisten). Nur für VITE_MOCK=1.
// Kleiner Katalog mit Verfügbarkeit je Loader/Minecraft-Version, daraus werden Vorschau, Prüfung und
// Kompatibilitätsübersicht berechnet – so passen alle Ansichten zusammen.
import type { LoaderKind, ProjectType } from "@/lib/types";
import type { Alternative, ModSet, ParsedLine, PreviewItem, Reason, SetEntry } from "@/features/modsets/api";
import { instances } from "./core";
import { fakeTask, mockEmit, tasks, type Handlers } from "./util";

const now = Date.now();
// Echte Icon-Dateien (aus den übrigen Mocks); sonst icon.png
const ICONS: Record<string, string> = { "AANobbMI": "295862f4724dc3f78df3447ad6072b2dcd3ef0c9_96.webp", "gvQqBUqZ": "bcc8686c13af0143adf4285d741256af824f70b7_96.webp", "uXXizFIs": "222a126f26f8f9ae1eb339f3b767677f18bff31f_96.webp", "nmDcB62a": "2af94de5e08ae54567ee86b968fc7ce076d9fee5_96.webp", "5ZwdcRci": "e57b6b451425692ac17ad322d5e14bea686a383a_96.webp", "NNAgCjsB": "7873452d6cede4daed12da3d7d8c193ab88b4fd6_96.webp", "mOgUt4GM": "5a20ed1450a0e1e79a1fe04e61bb4e5878bf1d20.png", "1bokaNcj": "354080f65407e49f486fcf9c4580e82c45ae63b8_96.webp", "u6dRKJwZ": "4a3f18ac0d096c9f8e9176984c44be4e58f94c89_96.webp", "Ha28R6CL": "72c3d74aeb665e45aea93a945a01474cbce3b7da_96.webp", "YL57xq9U": "18d0e7f076d3d6ed5bedd472b853909aac5da202_96.webp", "HVnmMxH1": "79cb7c8123bbc54945305b2ebad6b8881efdf5f8_96.webp", "Q1vvjJYV": "2a611a3cb434fb52fb81fa5dace13c5d8b67e55d_96.webp", "50dA9Sha": "3132c10e9e3c73fde9799720fd3da5561071708c_96.webp" };
const icon = (id: string) => `https://cdn.modrinth.com/data/${id}/${ICONS[id] ?? "icon.png"}`;

interface Project {
  id: string;
  slug: string;
  title: string;
  type: ProjectType;
  /** Loader -> unterstützte MC-Versionen; "*" = Loader egal (Shader/Ressourcenpakete) */
  support: Partial<Record<LoaderKind | "*", string[]>>;
  deps?: string[];
  source?: "modrinth" | "curseforge";
  version?: string;
}

const MODERN = ["1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.1"];
const ALL = [...MODERN, "1.19.4", "1.19.2", "1.18.2", "1.16.5"];
const catalog: Project[] = [
  { id: "AANobbMI", slug: "sodium", title: "Sodium", type: "mod", support: { fabric: ALL, quilt: ALL, neoforge: ["1.21.4", "1.21.3", "1.21.1"] }, version: "0.6.5" },
  { id: "gvQqBUqZ", slug: "lithium", title: "Lithium", type: "mod", support: { fabric: ALL, quilt: ALL, neoforge: ["1.21.4", "1.21.1"] }, version: "0.14.7" },
  { id: "uXXizFIs", slug: "ferrite-core", title: "FerriteCore", type: "mod", support: { fabric: ALL, quilt: ALL, forge: ALL, neoforge: MODERN }, version: "7.1.1" },
  { id: "nmDcB62a", slug: "modernfix", title: "ModernFix", type: "mod", support: { fabric: MODERN, quilt: MODERN, forge: ["1.20.1", "1.19.2", "1.18.2", "1.16.5"], neoforge: MODERN }, version: "5.20.2" },
  { id: "5ZwdcRci", slug: "immediatelyfast", title: "ImmediatelyFast", type: "mod", support: { fabric: MODERN, quilt: MODERN, forge: ["1.20.1"], neoforge: MODERN }, version: "1.3.4" },
  { id: "NNAgCjsB", slug: "entityculling", title: "Entity Culling", type: "mod", support: { fabric: ALL, quilt: ALL, forge: ALL, neoforge: MODERN }, version: "1.7.3" },
  { id: "LQ3K71Q1", slug: "dynamic-fps", title: "Dynamic FPS", type: "mod", support: { fabric: ALL, quilt: ALL, forge: ["1.20.1"], neoforge: MODERN }, version: "3.8.0" },
  { id: "51shyZVL", slug: "moreculling", title: "More Culling", type: "mod", support: { fabric: MODERN, quilt: MODERN }, version: "1.0.3" },
  { id: "P7dR8mSH", slug: "fabric-api", title: "Fabric API", type: "mod", support: { fabric: ALL, quilt: ALL }, version: "0.114.0" },
  { id: "mOgUt4GM", slug: "modmenu", title: "Mod Menu", type: "mod", support: { fabric: ALL, quilt: ALL }, deps: ["P7dR8mSH"], version: "13.0.2" },
  { id: "1bokaNcj", slug: "xaeros-minimap", title: "Xaero's Minimap", type: "mod", support: { fabric: ALL, quilt: ALL, forge: ALL, neoforge: MODERN }, version: "25.0.0" },
  { id: "u6dRKJwZ", slug: "jei", title: "Just Enough Items", type: "mod", support: { fabric: ["1.21.1", "1.21", "1.20.1"], forge: ALL, neoforge: MODERN }, version: "19.21.0" },
  { id: "EsAfCjCV", slug: "appleskin", title: "AppleSkin", type: "mod", support: { fabric: ALL, quilt: ALL, forge: ALL, neoforge: MODERN }, version: "3.0.6" },
  { id: "nvQzSEkH", slug: "jade", title: "Jade", type: "mod", support: { fabric: MODERN, quilt: MODERN, forge: ["1.20.1", "1.19.2"], neoforge: MODERN }, version: "17.2.2" },
  { id: "aC3cM3Vq", slug: "mouse-tweaks", title: "Mouse Tweaks", type: "mod", support: { fabric: ALL, quilt: ALL, forge: ALL, neoforge: MODERN }, version: "2.26.1" },
  { id: "O7RBXm3n", slug: "inventory-profiles-next", title: "Inventory Profiles Next", type: "mod", support: { fabric: MODERN, forge: ["1.20.1"], neoforge: MODERN }, deps: ["onSQdWhM", "Ha28R6CL"], version: "2.1.0" },
  { id: "onSQdWhM", slug: "libipn", title: "libIPN", type: "mod", support: { fabric: MODERN, forge: ["1.20.1"], neoforge: MODERN }, version: "6.4.0" },
  { id: "Ha28R6CL", slug: "fabric-language-kotlin", title: "Fabric Language Kotlin", type: "mod", support: { fabric: ALL, quilt: ALL }, version: "1.13.0" },
  { id: "GchcoXML", slug: "oculus", title: "Oculus", type: "mod", support: { forge: ["1.20.1", "1.19.2", "1.18.2"] }, version: "1.8.0" },
  { id: "YL57xq9U", slug: "iris", title: "Iris Shaders", type: "mod", support: { fabric: ALL, quilt: ALL, neoforge: ["1.21.4", "1.21.1"] }, deps: ["AANobbMI"], version: "1.8.8" },
  { id: "sk9rgfiA", slug: "embeddium", title: "Embeddium", type: "mod", support: { forge: ["1.20.1", "1.19.2", "1.18.2", "1.16.5"], neoforge: ["1.21.1", "1.20.4"] }, version: "1.0.15" },
  { id: "iAiqcykM", slug: "controlling", title: "Controlling", type: "mod", support: { forge: ALL, neoforge: MODERN }, version: "21.0.5" },
  { id: "HVnmMxH1", slug: "complementary-reimagined", title: "Complementary Shaders – Reimagined", type: "shader", support: { "*": ALL }, version: "r5.4" },
  { id: "Q1vvjJYV", slug: "bsl-shaders", title: "BSL Shaders", type: "shader", support: { "*": ALL }, version: "v10.0" },
  { id: "50dA9Sha", slug: "fresh-animations", title: "Fresh Animations", type: "resourcepack", support: { "*": ["1.21.4", "1.21.3", "1.21.1", "1.20.1"] }, version: "1.9.3" },
];
const byId = new Map(catalog.map((p) => [p.id, p]));
const bySlug = new Map(catalog.map((p) => [p.slug, p]));
const toEntry = (p: Project, added = now): SetEntry => ({ source: p.source ?? "modrinth", project_id: p.id, slug: p.slug, title: p.title, icon_url: icon(p.id), project_type: p.type, added });
const entries = (...slugs: string[]) => slugs.map((s, i) => toEntry(bySlug.get(s)!, now - 86400_000 * (20 - i)));

let sets: ModSet[] = [
  {
    id: "perf",
    name: "Performance",
    description: "Mehr FPS, weniger RAM – für jede Instanz",
    created: now - 86400_000 * 30,
    updated: now - 86400_000,
    apply_on_create: false,
    entries: entries("sodium", "lithium", "ferrite-core", "modernfix", "entityculling", "dynamic-fps", "immediatelyfast", "moreculling"),
  },
  {
    id: "qol",
    name: "Meine QoL-Mods",
    description: null,
    created: now - 86400_000 * 22,
    updated: now - 86400_000 * 3,
    apply_on_create: false,
    entries: entries("modmenu", "xaeros-minimap", "jei", "appleskin", "jade", "mouse-tweaks", "inventory-profiles-next", "controlling", "embeddium"),
  },
  {
    id: "shader",
    name: "Shader-Setup",
    description: "Iris + meine Lieblings-Shader",
    created: now - 86400_000 * 12,
    updated: now - 86400_000 * 12,
    apply_on_create: false,
    entries: entries("iris", "sodium", "complementary-reimagined", "bsl-shaders", "fresh-animations"),
  },
];

/** Was je Instanz installiert ist (Projekt-IDs) */
const installed: Record<string, string[]> = {
  survival: ["AANobbMI", "gvQqBUqZ", "uXXizFIs", "NNAgCjsB", "P7dR8mSH", "EsAfCjCV", "nmDcB62a", "LQ3K71Q1"],
  "hh-armors": ["P7dR8mSH"],
  "all-the-mods": ["uXXizFIs", "1bokaNcj", "u6dRKJwZ", "EsAfCjCV", "nvQzSEkH"],
};
/** Angewendete Sets je Instanz: Set-ID -> beim Anwenden bekannte Projekte */
const applied: Record<string, Record<string, string[]>> = {
  survival: { perf: ["AANobbMI", "gvQqBUqZ", "uXXizFIs", "nmDcB62a", "NNAgCjsB", "LQ3K71Q1"] },
  "all-the-mods": { qol: sets[1].entries.map((e) => e.project_id) },
};

const cmpMc = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};
const supports = (p: Project, mc: string, loader: LoaderKind) => {
  if (p.support["*"]) return p.support["*"].includes(mc);
  if (loader === "vanilla") return false;
  const own = p.support[loader] ?? [];
  const extra = loader === "quilt" ? (p.support.fabric ?? []) : [];
  return own.includes(mc) || extra.includes(mc);
};

function resolve(p: Project, mc: string, loader: LoaderKind): { ok: true } | { ok: false; reason: Reason; loaders: string[]; range: [string, string] | null; older: string | null } {
  if (supports(p, mc, loader)) return { ok: true };
  if (p.type === "mod" && loader === "vanilla") return { ok: false, reason: "needs_loader", loaders: [], range: null, older: null };
  const mine = p.support["*"] ?? [...(p.support[loader] ?? []), ...(loader === "quilt" ? (p.support.fabric ?? []) : [])];
  const sorted = [...new Set(mine)].sort(cmpMc);
  const older = sorted.filter((v) => cmpMc(v, mc) < 0).pop() ?? null;
  const forMc = Object.entries(p.support)
    .filter(([, v]) => v?.includes(mc))
    .map(([k]) => k);
  if (forMc.length) return { ok: false, reason: "other_loader", loaders: forMc, range: sorted.length ? [sorted[0], sorted[sorted.length - 1]] : null, older };
  if (sorted.length) return { ok: false, reason: "other_mc", loaders: [], range: [sorted[0], sorted[sorted.length - 1]], older };
  return { ok: false, reason: "other_loader", loaders: Object.keys(p.support), range: null, older: null };
}

const ALTS: Record<string, string[]> = { embeddium: ["sodium"], sodium: ["embeddium"], oculus: ["iris"], iris: ["oculus"], controlling: [] };

function previewItem(e: SetEntry, setIds: string[], instanceId: string): PreviewItem {
  const inst = instances.get(instanceId)!;
  const mc = inst.mc_version;
  const loader = inst.loader.kind;
  const have = installed[instanceId] ?? [];
  const p = byId.get(e.project_id);
  const base: PreviewItem = {
    key: `${e.source}:${e.project_id}`,
    entry: e,
    set_ids: setIds,
    status: "install",
    version_id: null,
    version_number: null,
    file_name: null,
    kind: null,
    reason: null,
    message: null,
    loaders: [],
    mc_range: null,
    alternatives: [],
    conflicts: [],
    deps: [],
    manual: false,
    installed_as: null,
    covered_by: null,
    selected: false,
  };
  if (!p) return { ...base, status: "unavailable", reason: "not_found" };
  if (have.includes(p.id)) return { ...base, status: "installed" };
  const r = resolve(p, mc, loader);
  if (!r.ok) {
    const alternatives: Alternative[] = [];
    for (const slug of ALTS[p.slug] ?? []) {
      const a = bySlug.get(slug);
      if (a && supports(a, mc, loader) && have.includes(a.id)) return { ...base, status: "installed", covered_by: a.title };
      if (a && supports(a, mc, loader))
        alternatives.push({ kind: "other_project", source: "modrinth", project_id: a.id, title: a.title, icon_url: icon(a.id), version_id: `${a.id}-v`, version_number: a.version ?? "1.0", mc_version: null, recommended: true });
    }
    if (r.older && (r.reason === "other_mc" || r.reason === "other_loader"))
      alternatives.push({ kind: "older_mc", source: "modrinth", project_id: p.id, title: p.title, icon_url: icon(p.id), version_id: `${p.id}-old`, version_number: `${p.version ?? "1.0"}+${r.older}`, mc_version: r.older, recommended: false });
    return { ...base, status: "unavailable", reason: r.reason, loaders: r.loaders, mc_range: r.range, alternatives };
  }
  const deps = (p.deps ?? [])
    .filter((d) => !have.includes(d))
    .map((d) => byId.get(d)!)
    .map((d) => ({ key: `modrinth:${d.id}`, title: d.title, icon_url: icon(d.id), version_number: d.version ?? "1.0" }));
  const conflicts = p.slug === "iris" && instanceId === "survival" ? ["OptiFabric"] : [];
  return {
    ...base,
    status: conflicts.length ? "conflict" : "install",
    conflicts,
    version_id: `${p.id}-v`,
    version_number: p.version ?? "1.0",
    file_name: `${p.slug}-${p.version}.jar`,
    kind: p.type === "shader" ? "shader" : p.type === "resourcepack" ? "resourcepack" : "mod",
    deps,
    selected: !conflicts.length,
  };
}

function merged(setIds: string[], only?: string[] | null) {
  const out: { e: SetEntry; ids: string[] }[] = [];
  for (const id of setIds) {
    const s = sets.find((x) => x.id === id);
    if (!s) throw { kind: "not_found", message: "Mod-Set nicht gefunden" };
    for (const e of s.entries) {
      if (only && !only.includes(`${e.source}:${e.project_id}`)) continue;
      const hit = out.find((x) => x.e.project_id === e.project_id);
      if (hit) hit.ids.push(id);
      else out.push({ e, ids: [id] });
    }
  }
  return out;
}

const info = (s: ModSet) => ({ ...s, used_by: Object.entries(applied).filter(([, a]) => s.id in a).map(([i]) => i) });
const touch = (id: string, f: (s: ModSet) => ModSet) => {
  sets = sets.map((s) => (s.id === id ? { ...f(s), updated: Date.now() } : s));
  return sets.find((s) => s.id === id)!;
};
const addUnique = (list: SetEntry[], add: SetEntry[]) => {
  const keys = new Set(list.map((e) => `${e.source}:${e.project_id}`));
  return [...list, ...add.filter((e) => !keys.has(`${e.source}:${e.project_id}`)).map((e) => ({ ...e, added: Date.now() }))];
};

function parseLine(line: string): ParsedLine {
  const l = line.trim().replace(/^[-*•]\s+/, "");
  const url = l.match(/modrinth\.com\/(?:mod|shader|resourcepack|datapack|project)\/([\w.-]+)/) ?? l.match(/curseforge\.com\/minecraft\/[\w-]+\/([\w.-]+)/);
  const key = (url?.[1] ?? l).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const exact = bySlug.get(key) ?? catalog.find((p) => p.title.toLowerCase() === l.toLowerCase());
  if (exact) return { line, status: "ok", entry: toEntry(exact), message: null };
  if (url) return { line, status: "not_found", entry: null, message: null };
  const guess = catalog.find((p) => p.title.toLowerCase().includes(l.toLowerCase().split(" ")[0]) && l.length > 2);
  if (guess) return { line, status: "guess", entry: toEntry(guess), message: null };
  return { line, status: "not_found", entry: null, message: null };
}

const friendSet = { name: "Lauras Survival-Basics", description: "Die Mods, die ich immer nehme", lines: ["sodium", "xaeros-minimap", "appleskin", "jade", "fresh-animations"].map((s) => ({ line: bySlug.get(s)!.title, status: "ok" as const, entry: toEntry(bySlug.get(s)!), message: null })) };

function finishTask(title: string, instanceId: string, message: string, onDone: () => void) {
  const id: string = fakeTask("content", title, instanceId, 2600, () => {
    onDone();
    const cur = tasks.get(id);
    if (cur) {
      const next = { ...cur, message };
      tasks.set(id, next);
      mockEmit("task://update", next);
    }
  });
  return id;
}

const handlers: Handlers = {
  sets_list: () => sets.map(info),
  sets_create: ({ name, description, entries: es }) => {
    const s: ModSet = { id: Math.random().toString(36).slice(2, 10), name: String(name).trim(), description: (description as string) || null, created: Date.now(), updated: Date.now(), entries: addUnique([], (es as SetEntry[]) ?? []), apply_on_create: false };
    sets = [...sets, s];
    return s;
  },
  sets_update: ({ id, name, description }) =>
    touch(id as string, (s) => ({ ...s, name: (name as string | null)?.trim() || s.name, description: description == null ? s.description : (description as string).trim() || null })),
  sets_set_apply_on_create: ({ id, enabled }) => touch(id as string, (s) => ({ ...s, apply_on_create: Boolean(enabled) })),
  sets_delete: ({ id }) => {
    sets = sets.filter((s) => s.id !== id);
    return null;
  },
  sets_duplicate: ({ id }) => {
    const src = sets.find((s) => s.id === id)!;
    const s = { ...src, id: Math.random().toString(36).slice(2, 10), name: `${src.name} (Kopie)`, created: Date.now(), updated: Date.now(), apply_on_create: false };
    sets = [...sets, s];
    return s;
  },
  sets_add_entries: ({ id, entries: es }) => touch(id as string, (s) => ({ ...s, entries: addUnique(s.entries, es as SetEntry[]) })),
  sets_remove_entries: ({ id, keys }) => touch(id as string, (s) => ({ ...s, entries: s.entries.filter((e) => !(keys as string[]).includes(`${e.source}:${e.project_id}`)) })),
  sets_parse_list: async ({ text }) => {
    await new Promise((r) => setTimeout(r, 700));
    return String(text)
      .split(/\n/)
      .flatMap((l) => (l.includes("://") ? [l] : l.split(",")))
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map(parseLine);
  },
  sets_import_text: async ({ text }) => {
    await new Promise((r) => setTimeout(r, 400));
    if (String(text).includes("VIBESET1.")) return friendSet;
    return { name: null, description: null, lines: String(text).split(/\n/).filter((l) => l.trim()).map(parseLine) };
  },
  sets_import_file: () => friendSet,
  sets_export_file: () => null,
  sets_export_code: () => "VIBESET1.jVLLbsIwEPwVy-dEgqqqIBYuhK1eJMRCUeOM7IS1G3tHtMHz7Xg0TihKOhUuL7PrHM-Ojc5k8ulJm3tBaunHr8EeT4Pdl8",
  sets_export_links: ({ id }) =>
    sets
      .find((s) => s.id === id)!
      .entries.map((e) => `https://modrinth.com/${e.project_type}/${e.slug}`)
      .join("\n"),
  sets_instance_candidates: ({ instanceId }) => ({
    items: (installed[instanceId as string] ?? []).map((pid, i) => ({ entry: toEntry(byId.get(pid)!), kind: "mod", file_name: `${byId.get(pid)!.slug}.jar`, enabled: i !== 3 })),
    unknown: instanceId === "survival" ? ["eigene-config-mod.jar", "OptiFabric-1.14.3.jar"] : [],
  }),
  sets_from_profile: ({ instanceId }) => {
    const s: ModSet = { id: Math.random().toString(36).slice(2, 10), name: "PvP-Abend", description: null, created: Date.now(), updated: Date.now(), entries: (installed[instanceId as string] ?? []).slice(0, 5).map((p) => toEntry(byId.get(p)!)), apply_on_create: false };
    sets = [...sets, s];
    return [s, 2];
  },
  sets_preview: async ({ instanceId, setIds, only }) => {
    await new Promise((r) => setTimeout(r, Number(localStorage.getItem("vl.mock.preview")) || 900));
    const inst = instances.get(instanceId as string)!;
    return {
      instance_id: instanceId,
      mc_version: inst.mc_version,
      loader: inst.loader.kind,
      items: merged(setIds as string[], only as string[] | null).map(({ e, ids }) => previewItem(e, ids, instanceId as string)),
    };
  },
  sets_apply: ({ instanceId, setIds, picks }) => {
    const n = (picks as unknown[]).length;
    return finishTask("Mod-Set anwenden", instanceId as string, `${n + 2} Datei(en) installiert`, () => {
      const iid = instanceId as string;
      installed[iid] = [...(installed[iid] ?? []), ...(picks as { project_id: string }[]).map((p) => p.project_id)];
      applied[iid] = { ...(applied[iid] ?? {}) };
      for (const id of setIds as string[]) applied[iid][id] = sets.find((s) => s.id === id)!.entries.map((e) => e.project_id);
    });
  },
  sets_install_new: ({ instanceId, setIds }) =>
    finishTask("Mod-Sets installieren", instanceId as string, "12 Datei(en) installiert, 1 übersprungen", () => {
      applied[instanceId as string] = Object.fromEntries((setIds as string[]).map((id) => [id, sets.find((s) => s.id === id)!.entries.map((e) => e.project_id)]));
    }),
  sets_check: async ({ setIds, mcVersion, loader }) => {
    await new Promise((r) => setTimeout(r, 500));
    const list = merged(setIds as string[]);
    const missing = list.filter(({ e }) => !byId.get(e.project_id) || !resolve(byId.get(e.project_id)!, mcVersion as string, loader as LoaderKind).ok);
    return {
      total: list.length,
      available: list.length - missing.length,
      missing: missing.map(({ e }) => ({ title: e.title, icon_url: e.icon_url, reason: (byId.get(e.project_id) && (resolve(byId.get(e.project_id)!, mcVersion as string, loader as LoaderKind) as { reason: Reason }).reason) || "not_found" })),
    };
  },
  sets_compat: async ({ id }) => {
    await new Promise((r) => setTimeout(r, 600));
    const s = sets.find((x) => x.id === id)!;
    const mcs = ["1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6", "1.20.1", "1.19.2", "1.18.2", "1.16.5", "1.12.2"];
    const loaders: LoaderKind[] = s.entries.some((e) => e.project_type === "mod") ? ["fabric", "quilt", "forge", "neoforge"] : ["vanilla", "fabric", "quilt", "forge", "neoforge"];
    const cells = loaders.flatMap((l) => mcs.map((mc) => ({ mc, loader: l, available: s.entries.filter((e) => byId.get(e.project_id) && supports(byId.get(e.project_id)!, mc, l)).length })));
    const best = [...cells].sort((a, b) => b.available - a.available || mcs.indexOf(a.mc) - mcs.indexOf(b.mc))[0] ?? null;
    return {
      total: s.entries.length,
      mc_versions: mcs,
      loaders,
      cells,
      best: best?.available ? best : null,
      entries: s.entries.map((e) => {
        const p = byId.get(e.project_id);
        if (!p) return { key: `${e.source}:${e.project_id}`, loaders: [], mc_min: null, mc_max: null, error: true };
        const all = [...new Set(Object.values(p.support).flat())].sort(cmpMc);
        const ls = (p.support["*"] ? loaders : (Object.keys(p.support) as LoaderKind[])).filter((l) => loaders.includes(l));
        return { key: `${e.source}:${e.project_id}`, loaders: ls, mc_min: all[0] ?? null, mc_max: all[all.length - 1] ?? null, error: false };
      }),
    };
  },
  sets_news: ({ instanceId }) => {
    const a = applied[instanceId as string] ?? {};
    const have = installed[instanceId as string] ?? [];
    return Object.entries(a)
      .map(([sid, known]) => {
        const s = sets.find((x) => x.id === sid);
        if (!s) return null;
        const n = s.entries.filter((e) => !known.includes(e.project_id) && !have.includes(e.project_id));
        return n.length ? { set_id: sid, name: s.name, new_entries: n } : null;
      })
      .filter(Boolean);
  },
  sets_dismiss_news: ({ instanceId, setId, forget }) => {
    const iid = instanceId as string;
    applied[iid] = { ...(applied[iid] ?? {}) };
    if (forget) delete applied[iid][setId as string];
    else applied[iid][setId as string] = sets.find((s) => s.id === setId)!.entries.map((e) => e.project_id);
    return null;
  },
};

// Screenshots: localStorage vl.mock.sets = empty -> keine Sets (Leerzustand)
try {
  if (localStorage.getItem("vl.mock.sets") === "empty") sets = [];
} catch {
  /* egal */
}

export default handlers;
