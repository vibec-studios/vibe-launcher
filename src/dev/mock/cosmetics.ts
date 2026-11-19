// Mock: Cosmetics-Katalog, Loadout, Einreichungen und Blockbench-Status. Nur für VITE_MOCK=1.
// Die 3D-Modelle selbst gibt es im Mock nicht (vibey_cosmetic_asset schlägt fehl) – Kacheln und Seite sind sichtbar.
import type { BlockbenchStatus, Catalog, CatalogItem, CosmeticSlot, Submission } from "@/features/cosmetics/types";
import type { Handlers } from "./util";

const day = 86400_000;
function item(id: string, slot: CosmeticSlot | null, en: string, de: string, rarity: CatalogItem["rarity"], extra: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id,
    kind: slot ? "cosmetic" : "emote",
    slot,
    name: { en, de },
    description: { de: `${de} für deinen Charakter.`, en: `${en} for your character.` },
    author: "Vibe Craft Studios",
    tags: [],
    rarity,
    availability: "default",
    asset: { hash: id, size: 1200, url: `https://vibe.mock/assets/${id}` },
    thumbnailUrl: null,
    sort: 0,
    createdAt: new Date(Date.now() - 30 * day).toISOString(),
    updatedAt: new Date(Date.now() - 3 * day).toISOString(),
    ...extra,
  };
}

export const catalog: Catalog = {
  version: "mock-1",
  items: [
    item("cape-vibe", "cape", "Vibe Cape", "Vibe-Umhang", "rare"),
    item("cape-night", "cape", "Night Cape", "Nacht-Umhang", "common"),
    item("wings-pixel", "wings", "Pixel Wings", "Pixel-Flügel", "epic"),
    item("aura-snow", "aura", "Snow Aura", "Schnee-Aura", "legendary", { availability: "granted" }),
    item("pet-seal", "pet", "Seal Buddy", "Robben-Kumpel", "epic", { creator: { uuid: "00000000-0000-0000-0000-000000000001", name: "Lumi_Builds" } }),
    item("hat-beanie", "hat", "Beanie", "Mütze", "common"),
    item("hat-crown", "hat", "Crown", "Krone", "legendary", { availability: "granted" }),
    item("back-sword", "back", "Back Sword", "Rückenschwert", "rare"),
    item("shield-oak", "shield", "Oak Shield", "Eichenschild", "common"),
    item("emote-wave", null, "Wave", "Winken", "common"),
    item("emote-dance", null, "Dance", "Tanzen", "rare"),
    item("emote-sit", null, "Sit", "Hinsetzen", "common"),
  ],
};

export const me = {
  owned: catalog.items.filter((i) => i.availability === "default").map((i) => i.id).concat("aura-snow"),
  loadout: { slots: { cape: "cape-vibe", hat: "hat-beanie" }, emoteWheel: ["emote-wave", "emote-dance", null, null, null, null, null, null] },
};

export const submissions: Submission[] = [
  { id: "sub1", name: "Kürbiskopf", description: "Für Halloween", kind: "cosmetic", status: "pending", createdAt: new Date(Date.now() - 2 * day).toISOString(), assetUrl: "" },
  { id: "sub2", name: "Robben-Tanz", description: "", kind: "emote", status: "approved", createdAt: new Date(Date.now() - 12 * day).toISOString(), reviewedAt: new Date(Date.now() - 10 * day).toISOString(), assetUrl: "" },
];

const blockbench: BlockbenchStatus = {
  blockbench: "C:/Users/steve/AppData/Local/Programs/Blockbench/Blockbench.exe",
  plugin_path: "C:/Users/steve/AppData/Roaming/VibeLauncher/blockbench/vibey.js",
  plugin_present: true,
  plugin_version: "0.3.0",
  registered: true,
  latest_version: "0.3.0",
  min_client: "0.3.0",
  notes: null,
  update_available: false,
  error: null,
};

const handlers: Handlers = {
  vibey_cosmetics_catalog: () => ({ catalog, cached: false }),
  vibey_cosmetic_thumbnail: () => null,
  vibey_cosmetic_asset: () => {
    throw { kind: "error", message: "Mock: keine 3D-Modelle" };
  },
  vibey_client_instances: () => [
    { instance_id: "survival", name: "Cobblemon Abenteuer", mc_version: "1.21.4", loader: "fabric", version: "0.3.0", game_dir: "C:/Users/steve/AppData/Roaming/VibeLauncher/instances/survival", devlink: true },
  ],
  vibey_blockbench_status: () => blockbench,
  vibey_blockbench_install_plugin: () => blockbench,
  vibey_blockbench_open: () => null,
  vibey_blockbench_reveal_plugin: () => null,
};

export default handlers;
