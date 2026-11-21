import type { Account, Instance } from "@/lib/types";
import { instances } from "./core";
import b from "./b";
import { makeSkin } from "./skins";
import type { Handlers } from "./util";

const flag = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

const on = flag("vl.mock.many") === "1";
const now = Date.now();
const names = [
  "Create Ultimate",
  "Shalz One Block",
  "Theme Park",
  "Create Server",
  "Fabric 1.21",
  "Cobblemon Island",
  "Better MC",
  "Skyblock Classic",
  "Prominence II",
  "Vault Hunters",
  "Medieval MC",
  "RLCraft Dregora",
  "Cottage Witch",
  "Pixelmon Test",
  "Optimized Vanilla",
  "Survival Friends",
  "Redstone Lab",
  "Mod Testbed",
];
const accents = ["#ff6b9a", "#3fe0c5", "#e0a43f", "#8b6cff", "#5fbf4a", "#4aa3ff", "#ff8a3d"];
const counts: Record<string, number> = { survival: 3, "hh-armors": 5 };

if (on) {
  const base = instances.get("survival");
  if (base)
    names.forEach((name, n) => {
      const id = `many-${n}`;
      const extra: Partial<Instance> = { id, name, accent: accents[n % accents.length], last_played: now - (n + 2) * 5 * 3600_000, play_time_secs: 3600 * (n + 1) };
      instances.set(id, { ...base, ...extra });
      counts[id] = [67, 2, 11, 1, 47, 3, 2, 9, 1, 2, 24, 4, 2, 1, 6, 2, 3, 1][n];
    });
}

const handlers: Handlers = on
  ? {
      content_update_counts: () => ({ ...counts }),
      accounts_list: (args) =>
        (b.accounts_list(args) as Account[]).map((a, n) => ({ ...a, skin_url: makeSkin(n ? "#e76f51" : "#2a9d8f", "#264653", n ? "#e8c170" : "#4a2c1a") })),
    }
  : {};

export const priority = 1;

export default handlers;
