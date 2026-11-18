// Mock-Erweiterung (nur VITE_MOCK=1 + VITE_MOCK_MODRINTH=live): Entdecken/Projektseite fragen die echte
// Modrinth-API direkt aus dem Browser ab (CORS erlaubt) – so lässt sich das Design mit echten Daten prüfen.
// Bildet die Zuordnung aus src-tauri/src/content/modrinth.rs nach. Nie im Produktions-Build.
import type { Category, ContentItem, GalleryImage, ProjectDetails, ProjectHit, ProjectType, ProjectVersion, SearchQuery, SearchResult } from "@/lib/types";
import type { Handlers } from "./util";

const API = "https://api.modrinth.com/v2";
const LOADER_TAGS = new Set([
  "fabric", "forge", "neoforge", "quilt", "liteloader", "modloader", "rift", "iris", "optifine", "canvas", "vanilla", "minecraft", "datapack",
  "bukkit", "paper", "spigot", "purpur", "folia", "velocity", "bungeecord", "waterfall", "sponge", "babric", "bta-babric", "java-agent",
  "legacy-fabric", "ornithe", "nilloader",
]);

const cache = new Map<string, Promise<unknown>>();
function get<T>(path: string): Promise<T> {
  const url = API + path;
  if (!cache.has(url))
    cache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw { kind: "network", message: `Modrinth: HTTP ${r.status}` };
        return r.json();
      }),
    );
  const p = cache.get(url) as Promise<T>;
  p.catch(() => cache.delete(url));
  return p;
}

function split(cats: string[]) {
  const c: string[] = [];
  const l: string[] = [];
  for (const x of cats) (LOADER_TAGS.has(x) ? l : c).includes(x) || (LOADER_TAGS.has(x) ? l : c).push(x);
  return [c, l] as const;
}

const typeOf = (t: string, loaders: string[]): ProjectType =>
  t === "mod" && loaders.length && loaders.every((l) => l === "datapack") ? "datapack" : (["mod", "modpack", "resourcepack", "shader"].includes(t) ? t : "mod") as ProjectType;

function facets(q: SearchQuery): string {
  const f: string[][] = [q.project_type === "datapack" ? ["categories:datapack"] : [`project_type:${q.project_type}`]];
  if (q.game_version) f.push([`versions:${q.game_version}`]);
  if (q.loader && (q.project_type === "mod" || q.project_type === "modpack")) f.push(q.loader === "quilt" ? ["categories:quilt", "categories:fabric"] : [`categories:${q.loader}`]);
  for (const c of q.categories) f.push([`categories:${c}`]);
  if (q.created_after) f.push([`created_timestamp>${q.created_after}`]);
  return JSON.stringify(f);
}

const INDEX: Record<string, string> = { relevance: "relevance", downloads: "downloads", follows: "follows", newest: "newest", updated: "updated" };

interface MrHit {
  project_id: string;
  slug: string | null;
  title: string;
  description: string;
  author: string;
  icon_url: string | null;
  downloads: number;
  follows: number;
  display_categories: string[];
  categories: string[];
  project_type: string;
  date_modified: string | null;
  date_created: string | null;
  versions: string[];
  featured_gallery: string | null;
  gallery: string[];
  color: number | null;
}

async function search(q: SearchQuery): Promise<SearchResult> {
  const p = new URLSearchParams({ query: q.query, facets: facets(q), index: INDEX[q.sort] ?? "relevance", offset: String(q.offset), limit: String(Math.min(q.limit, 100)) });
  const r = await get<{ hits: MrHit[]; total_hits: number }>(`/search?${p}`);
  const hits = r.hits.map((h): ProjectHit => {
    const [cats, loaders] = split(h.display_categories.length ? h.display_categories : h.categories);
    return {
      source: "modrinth",
      id: h.project_id,
      slug: h.slug ?? h.project_id,
      title: h.title,
      description: h.description,
      author: h.author,
      icon_url: h.icon_url || null,
      downloads: h.downloads,
      follows: h.follows,
      categories: cats,
      project_type: typeOf(h.project_type, split(h.categories)[1]),
      updated: h.date_modified,
      game_versions: [...h.versions].reverse(),
      loaders,
      banner_url: h.featured_gallery || h.gallery[0] || null,
      color: h.color,
      created: h.date_created,
    };
  });
  return { hits, total: r.total_hits, offset: q.offset, limit: q.limit };
}

interface MrProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  categories: string[];
  additional_categories: string[];
  project_type: string;
  downloads: number;
  followers: number;
  icon_url: string | null;
  issues_url: string | null;
  source_url: string | null;
  wiki_url: string | null;
  discord_url: string | null;
  donation_urls: { url: string }[] | null;
  license: { id: string; name: string } | null;
  published: string | null;
  updated: string | null;
  game_versions: string[];
  loaders: string[];
  gallery: { url: string; featured: boolean; title: string | null; description: string | null; ordering: number }[];
  color: number | null;
}

async function project(id: string): Promise<ProjectDetails> {
  const [p, members] = await Promise.all([get<MrProject>(`/project/${id}`), get<{ role: string; user: { username: string } }[]>(`/project/${id}/members`).catch(() => [])]);
  const [cats] = split([...p.categories, ...p.additional_categories]);
  const gallery = [...p.gallery].sort((a, b) => Number(b.featured) - Number(a.featured) || a.ordering - b.ordering);
  const owner = members.find((m) => m.role === "Owner") ?? members[0];
  return {
    source: "modrinth",
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    author: owner?.user.username ?? "",
    icon_url: p.icon_url || null,
    downloads: p.downloads,
    follows: p.followers,
    categories: cats,
    project_type: typeOf(p.project_type, p.loaders),
    updated: p.updated,
    game_versions: [...p.game_versions].reverse(),
    loaders: p.loaders,
    banner_url: gallery[0]?.url ?? null,
    color: p.color,
    created: p.published,
    body: p.body,
    body_format: "markdown",
    gallery: gallery.map((g): GalleryImage => ({ url: g.url, title: g.title, description: g.description, featured: g.featured })),
    links: { website: p.donation_urls?.[0]?.url ?? null, source: p.source_url, issues: p.issues_url, wiki: p.wiki_url, discord: p.discord_url },
    license: p.license ? p.license.name || p.license.id : null,
    published: p.published,
    page_url: `https://modrinth.com/${p.project_type}/${p.slug}`,
  };
}

interface MrVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  version_type: "release" | "beta" | "alpha";
  date_published: string;
  downloads: number;
  changelog: string | null;
  files: { url: string; filename: string; size: number; primary: boolean; hashes: { sha1?: string; sha512?: string } }[];
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: "required" | "optional" | "incompatible" | "embedded" }[];
}

async function versions(id: string): Promise<ProjectVersion[]> {
  const v = await get<MrVersion[]>(`/project/${id}/version`);
  return v.map((x) => ({
    source: "modrinth",
    id: x.id,
    project_id: x.project_id,
    name: x.name,
    version_number: x.version_number,
    game_versions: x.game_versions,
    loaders: x.loaders,
    release_type: x.version_type,
    date: x.date_published,
    downloads: x.downloads,
    changelog: x.changelog,
    files: x.files.map((f) => ({ url: f.url, filename: f.filename, size: f.size, sha1: f.hashes.sha1 ?? null, sha512: f.hashes.sha512 ?? null, primary: f.primary })),
    dependencies: x.dependencies.map((d) => ({ project_id: d.project_id, version_id: d.version_id, kind: d.dependency_type })),
  }));
}

async function categories(t: string): Promise<Category[]> {
  const all = await get<{ name: string; project_type: string; header: string }[]>("/tag/category");
  const pt = t === "datapack" ? "mod" : t;
  return all
    .filter((c) => c.project_type === pt)
    .sort((a, b) => a.header.localeCompare(b.header) || a.name.localeCompare(b.name))
    .map((c) => ({ id: c.name, name: c.name.replace(/-/g, " "), icon: null }));
}

/** Echte Modrinth-IDs, die in der Mock-Instanz „survival“ (Fabric) als installiert gelten. */
const INSTALLED_LIVE: [string, string][] = [
  ["AANobbMI", "Sodium"],
  ["P7dR8mSH", "Fabric API"],
  ["YL57xq9U", "Iris Shaders"],
  ["mOgUt4GM", "Mod Menu"],
  ["gvQqBUqZ", "Lithium"],
];

export function withLiveModrinth(base: Handlers): Handlers {
  const live = (src: unknown) => src === "modrinth";
  return {
    ...base,
    content_search: async (args) => {
      const q = args.query as SearchQuery;
      return live(q.source) ? search(q) : base.content_search(args);
    },
    content_categories: async (args) => (live(args.source) ? categories(args.projectType as string) : base.content_categories(args)),
    content_project: async (args) => (live(args.source) ? project(args.id as string) : base.content_project(args)),
    content_versions: async (args) => {
      if (!live(args.source)) return base.content_versions(args);
      const all = await versions(args.id as string);
      return all.filter((v) => (!args.gameVersion || v.game_versions.includes(args.gameVersion as string)) && (!args.loader || v.loaders.includes(args.loader as string)));
    },
    content_list: async (args) => {
      const items = (await base.content_list(args)) as ContentItem[];
      if (args.instanceId !== "survival" || args.kind !== "mod") return items;
      const extra = INSTALLED_LIVE.map(([id, name], i): ContentItem => ({
        file_name: `${name.toLowerCase().replace(/\s+/g, "-")}.jar`,
        kind: "mod",
        enabled: true,
        name,
        version: `1.${i}.0`,
        description: null,
        authors: [],
        icon: `https://cdn.modrinth.com/data/${id}/icon.png`,
        source: "modrinth",
        project_id: id,
        version_id: null,
        size: 400_000,
        modified: Date.now(),
        pinned: false,
        side: "unknown",
      }));
      return [...extra, ...items];
    },
  };
}
