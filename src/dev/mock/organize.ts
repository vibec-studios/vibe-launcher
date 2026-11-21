import type { ContentItem, ContentKind } from "@/lib/types";
import type { OrgGroup, Organize, RemovalExtra, Target } from "@/features/content/organize/api";
import b from "./b";
import { instances } from "./core";
import type { Handlers } from "./util";

interface Store {
  groups: { id: string; name: string; color: string | null }[];
  members: Map<string, string>;
  tags: Map<string, string[]>;
  auto: Map<string, string[]> | null;
  kept: Set<string>;
}

const stores = new Map<string, Store>();
const key = (kind: ContentKind, file: string) => `${kind}:${file.replace(/\.disabled$/i, "")}`;
const KINDS: ContentKind[] = ["mod", "resourcepack", "shader"];

async function listAll(id: string): Promise<ContentItem[]> {
  const out: ContentItem[] = [];
  for (const kind of KINDS) out.push(...((await b.content_list({ instanceId: id, kind })) as ContentItem[]));
  return out;
}

function store(id: string): Store {
  let s = stores.get(id);
  if (!s) {
    s = { groups: [], members: new Map(), tags: new Map(), auto: null, kept: new Set() };
    stores.set(id, s);
  }
  return s;
}

function seedAuto(s: Store, items: ContentItem[]) {
  if (s.auto) return s.auto;
  const mods = items.filter((c) => c.kind === "mod");
  const auto = new Map<string, string[]>();
  mods.forEach((m, i) => {
    if (i % 9 !== 4) return;
    const users = i % 18 === 4 ? [] : [mods[(i + 1) % mods.length].name, ...(i % 4 === 0 ? [mods[(i + 2) % mods.length].name] : [])];
    auto.set(key(m.kind, m.file_name), users);
  });
  s.auto = auto;
  return auto;
}

function seedGroups(id: string, s: Store, items: ContentItem[]) {
  if (id !== "survival" || s.groups.length || s.members.size) return;
  s.groups.push({ id: "g-gfx", name: "Grafik", color: "#5b8def" }, { id: "g-map", name: "Karten", color: "#3fb68b" });
  const mods = items.filter((c) => c.kind === "mod");
  mods.slice(0, 4).forEach((m) => s.members.set(key(m.kind, m.file_name), "g-gfx"));
  mods.slice(6, 9).forEach((m) => s.members.set(key(m.kind, m.file_name), "g-map"));
  if (mods[0]) s.tags.set(key("mod", mods[0].file_name), ["fps", "grafik"]);
}

async function view(id: string): Promise<Organize> {
  const items = await listAll(id);
  const s = store(id);
  seedGroups(id, s, items);
  const auto = seedAuto(s, items);
  const names = new Set(items.map((c) => c.name));
  const hasPack = !!instances.get(id)?.source;
  const mods = items.filter((c) => c.kind === "mod");
  const packSet = new Set(hasPack ? mods.filter((_, i) => i % 7 !== 0).map((c) => key(c.kind, c.file_name)) : []);
  const info = items.map((c) => {
    const k = key(c.kind, c.file_name);
    const isAuto = c.kind === "mod" && auto.has(k) && !s.kept.has(k) && !packSet.has(k);
    const needed = isAuto ? auto.get(k)!.filter((n) => names.has(n)) : [];
    const g = s.members.get(k);
    return {
      kind: c.kind,
      file: c.file_name.replace(/\.disabled$/i, ""),
      group: g && s.groups.some((x) => x.id === g) ? g : null,
      tags: s.tags.get(k) ?? [],
      from_pack: packSet.has(k),
      auto: isAuto,
      unused: isAuto && needed.length === 0,
      needed_by: needed,
    };
  });
  const groups: OrgGroup[] = s.groups.map((g) => {
    const list = items.filter((c) => s.members.get(key(c.kind, c.file_name)) === g.id);
    return { ...g, count: list.length, enabled: list.filter((c) => c.enabled).length };
  });
  const tags = [...new Set([...s.tags.values()].flat())].sort((a, z) => a.localeCompare(z));
  return { groups, items: info, tags, has_pack: hasPack, pack_count: info.filter((i) => i.from_pack).length, unused_count: info.filter((i) => i.unused).length };
}

const targetKeys = (targets: unknown) => (targets as Target[]).map((t) => key(t.kind, t.file_name));

const handlers: Handlers = {
  content_organize: ({ instanceId }) => view(instanceId as string),
  content_group_save: ({ instanceId, groupId, name, color, targets }) => {
    const id = instanceId as string;
    const s = store(id);
    const n = String(name ?? "").trim().replace(/\s+/g, " ");
    if (!n) throw { kind: "invalid", message: "Bitte gib der Gruppe einen Namen." };
    if (s.groups.some((g) => g.id !== groupId && g.name.toLowerCase() === n.toLowerCase())) throw { kind: "invalid", message: `Es gibt schon eine Gruppe „${n}“.` };
    let gid = groupId as string | null;
    if (gid) Object.assign(s.groups.find((g) => g.id === gid)!, { name: n, color: (color as string | null) ?? null });
    else {
      gid = Math.random().toString(36).slice(2, 14);
      s.groups.push({ id: gid, name: n, color: (color as string | null) ?? null });
    }
    for (const k of targetKeys(targets ?? [])) s.members.set(k, gid);
    return view(id);
  },
  content_group_delete: ({ instanceId, groupId }) => {
    const s = store(instanceId as string);
    s.groups = s.groups.filter((g) => g.id !== groupId);
    for (const [k, g] of s.members) if (g === groupId) s.members.delete(k);
    return view(instanceId as string);
  },
  content_group_assign: ({ instanceId, targets, groupId }) => {
    const s = store(instanceId as string);
    for (const k of targetKeys(targets)) {
      if (groupId) s.members.set(k, groupId as string);
      else s.members.delete(k);
    }
    return view(instanceId as string);
  },
  content_tags_edit: ({ instanceId, targets, add, remove }) => {
    const s = store(instanceId as string);
    const rm = (remove as string[]).map((x) => x.toLowerCase());
    for (const k of targetKeys(targets)) {
      const cur = (s.tags.get(k) ?? []).filter((x) => !rm.includes(x.toLowerCase()));
      for (const a of add as string[]) {
        const v = a.trim().replace(/^#/, "").slice(0, 24);
        if (v && !cur.some((x) => x.toLowerCase() === v.toLowerCase())) cur.push(v);
      }
      if (cur.length) s.tags.set(k, cur);
      else s.tags.delete(k);
    }
    return view(instanceId as string);
  },
  content_deps_keep: ({ instanceId, targets }) => {
    const s = store(instanceId as string);
    for (const k of targetKeys(targets)) s.kept.add(k);
    return view(instanceId as string);
  },
  content_removal_extras: async ({ instanceId, targets }): Promise<RemovalExtra[]> => {
    const id = instanceId as string;
    const items = await listAll(id);
    const v = await view(id);
    const removed = new Set(targetKeys(targets));
    const removedNames = new Set(items.filter((c) => removed.has(key(c.kind, c.file_name))).map((c) => c.name));
    return v.items
      .filter((i) => i.auto && !i.unused && !removed.has(key(i.kind, i.file)) && i.needed_by.every((n) => removedNames.has(n)))
      .map((i) => {
        const c = items.find((x) => key(x.kind, x.file_name) === key(i.kind, i.file))!;
        return { kind: c.kind, file_name: c.file_name, name: c.name, enabled: c.enabled };
      });
  },
};

export default handlers;
