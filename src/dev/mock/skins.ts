// Mock-Handler Skins & Capes (OWNER: Auth-Agent). Texturen werden per Canvas erzeugt.
import type { Cape, LibrarySkin, SkinProfile, SkinVariant } from "@/lib/types";
import { mockEmit, type Handlers } from "./util";

/** Einfache 64×64-Skin-Textur in Wunschfarben. */
export function makeSkin(shirt: string, pants: string, hair: string, skinTone = "#c58c64"): string {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  const r = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  r(0, 0, 32, 16, skinTone); // Kopf
  r(8, 0, 8, 8, hair); // Kopf oben
  r(0, 8, 32, 2, hair); // Haaransatz rundum
  r(9, 12, 2, 1, "#fff");
  r(13, 12, 2, 1, "#fff");
  r(10, 12, 1, 1, "#2b4bd8");
  r(14, 12, 1, 1, "#2b4bd8");
  r(11, 14, 2, 1, "#7a4a3a");
  r(16, 16, 24, 16, shirt); // Körper
  r(40, 16, 16, 16, shirt); // rechter Arm
  r(44, 28, 4, 4, skinTone);
  r(32, 48, 16, 16, shirt); // linker Arm
  r(36, 60, 4, 4, skinTone);
  r(0, 16, 16, 16, pants); // rechtes Bein
  r(16, 48, 16, 16, pants); // linkes Bein
  r(4, 30, 4, 2, "#333");
  r(20, 62, 4, 2, "#333");
  return c.toDataURL("image/png");
}

function makeCape(main: string, accent: string): string {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = main;
  g.fillRect(0, 0, 22, 17);
  g.fillStyle = accent;
  g.fillRect(3, 4, 6, 6);
  g.fillRect(1, 14, 10, 2);
  return c.toDataURL("image/png");
}

const variantOf = (v: unknown): SkinVariant => (v === "slim" ? "slim" : "classic");

let lib: LibrarySkin[] = [];
let libInit = false;
function library() {
  if (!libInit) {
    libInit = true;
    const now = Date.now();
    lib = [
      { id: "l1", name: "Wüstenwanderer", variant: "classic", file: "l1.png", added_at: now - 1000, source: "file", data_url: makeSkin("#d9a441", "#6b4f2a", "#3a2a1a") },
      { id: "l2", name: "Neon", variant: "slim", file: "l2.png", added_at: now - 2000, source: "player:Neon", data_url: makeSkin("#8b6cff", "#1d1d2b", "#3fe0c5", "#e8b896") },
      { id: "l3", name: "Holzfäller", variant: "classic", file: "l3.png", added_at: now - 3000, source: "account:Henny", data_url: makeSkin("#b3262e", "#2f3f7a", "#1a1a1a") },
    ];
  }
  return lib;
}

const profiles = new Map<string, SkinProfile>();
function profile(accountId: string): SkinProfile {
  let p = profiles.get(accountId);
  if (!p) {
    const capes: Cape[] = [
      { id: "c1", alias: "Migrator", url: "", state: "ACTIVE", data_url: makeCape("#2d6bd1", "#9ad0ff") },
      { id: "c2", alias: "Vanilla", url: "", state: "INACTIVE", data_url: makeCape("#6aa84f", "#f1e05a") },
      { id: "c3", alias: "Cherry Blossom", url: "", state: "INACTIVE", data_url: makeCape("#f4a6c8", "#ffffff") },
    ];
    p = {
      account_id: accountId,
      username: accountId === "a1" ? "Henny" : "Steve_Builder",
      skin: { id: "s-" + accountId, url: "", variant: "classic", data_url: makeSkin("#2a9d8f", "#264653", "#4a2c1a") },
      capes,
    };
    profiles.set(accountId, p);
  }
  return structuredClone(p);
}
function update(accountId: string, f: (p: SkinProfile) => void): SkinProfile {
  const p = profile(accountId);
  f(p);
  profiles.set(accountId, p);
  mockEmit("skins://changed", { scope: "profile", account_id: accountId });
  return structuredClone(p);
}
const acc = (a: Record<string, unknown>) => (a.accountId as string | null) ?? "a1";
const libChanged = () => mockEmit("skins://changed", { scope: "library" });
const add = (name: string, variant: SkinVariant, source: string, data_url: string) => {
  const s: LibrarySkin = { id: "l" + Date.now() + Math.floor(Math.random() * 99), name, variant, file: "x.png", added_at: Date.now(), source, data_url };
  library().unshift(s);
  libChanged();
  return s;
};

const handlers: Handlers = {
  skins_profile: (a) => profile(acc(a)),
  skin_upload_file: (a) =>
    update(acc(a), (p) => {
      p.skin = { id: "up", url: "", variant: variantOf(a.variant), data_url: makeSkin("#e76f51", "#264653", "#000") };
    }),
  skin_apply_library: (a) => {
    const s = library().find((x) => x.id === a.id);
    if (!s) throw { kind: "not_found", message: "Nicht gefunden: Skin" };
    return update(acc(a), (p) => {
      p.skin = { id: s.id, url: "", variant: a.variant ? variantOf(a.variant) : s.variant, data_url: s.data_url };
    });
  },
  skin_set_variant: (a) =>
    update(acc(a), (p) => {
      if (p.skin) p.skin.variant = variantOf(a.variant);
    }),
  skin_reset: (a) =>
    update(acc(a), (p) => {
      p.skin = { id: "default", url: "", variant: "classic", data_url: makeSkin("#3fb5c9", "#3b3bb0", "#3a2414") };
    }),
  cape_set: (a) =>
    update(acc(a), (p) => {
      p.capes = p.capes.map((c) => ({ ...c, state: c.id === a.capeId ? "ACTIVE" : "INACTIVE" }));
    }),
  skin_library_list: () => library().map((s) => ({ ...s })),
  skin_library_add_file: (a) => add(String(a.path).split(/[\\/]/).pop()!.replace(/\.png$/i, ""), variantOf(a.variant), "file", makeSkin("#999", "#555", "#222")),
  skin_library_add_current: (a) => {
    const p = profile(acc(a));
    return add(p.username, p.skin?.variant ?? "classic", "account:" + p.username, p.skin!.data_url!);
  },
  skin_library_import_player: async (a) => {
    const name = String(a.name);
    await new Promise((r) => setTimeout(r, 500));
    if (name.toLowerCase() === "ratelimit") throw { kind: "error", message: "Zu viele Anfragen an Mojang – bitte kurz warten." };
    if (name.toLowerCase().startsWith("x")) throw { kind: "not_found", message: `Nicht gefunden: Spieler „${name}“` };
    return add(name, "classic", "player:" + name, makeSkin("#4a7a2b", "#3b2a1a", "#d8c27a"));
  },
  skin_library_rename: (a) => {
    const s = library().find((x) => x.id === a.id)!;
    s.name = String(a.name);
    libChanged();
    return { ...s };
  },
  skin_library_set_variant: (a) => {
    const s = library().find((x) => x.id === a.id)!;
    s.variant = variantOf(a.variant);
    libChanged();
    return { ...s };
  },
  skin_library_remove: (a) => {
    lib = library().filter((x) => x.id !== a.id);
    libChanged();
  },
  skin_library_export: () => null,
  skin_library_reveal: () => null,
};

export default handlers;
