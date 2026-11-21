import type { Instance } from "@/lib/types";
import type { Friend } from "@/lib/vibe-sdk";

export function normAddress(a: string | null | undefined): string {
  if (!a) return "";
  const s = a.trim().toLowerCase().replace(/\.$/, "");
  return s.endsWith(":25565") ? s.slice(0, -6) : s;
}

export function friendsOn(friends: Friend[], address: string): Friend[] {
  const a = normAddress(address);
  return friends.filter((f) => f.presence.status !== "offline" && f.presence.activity?.type === "playing" && normAddress(f.presence.activity.server) === a);
}

function versionsOf(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(/1\.\d{1,2}(?:\.\d{1,2})?/g)].map((m) => m[0]);
}

function cmp(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function inRange(v: string, list: string[]) {
  if (list.length < 2) return list.includes(v);
  const sorted = [...list].sort(cmp);
  return cmp(v, sorted[0]) >= 0 && cmp(v, sorted[sorted.length - 1]) <= 0;
}

export function suggestInstance(instances: Instance[], version: string | null | undefined): Instance | null {
  const vs = versionsOf(version);
  const plain = instances.filter((i) => i.loader.kind === "vanilla" || i.loader.kind === "fabric" || i.loader.kind === "quilt");
  const pool = plain.length ? plain : instances;
  const byPlayed = [...pool].sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0));
  if (!vs.length) return byPlayed[0] ?? null;
  return byPlayed.find((i) => vs.includes(i.mc_version)) ?? byPlayed.find((i) => inRange(i.mc_version, vs)) ?? null;
}

export function validAddress(a: string) {
  const s = a.trim();
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/i.test(s) && s.length <= 260;
}
