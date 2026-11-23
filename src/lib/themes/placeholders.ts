export type GreetingPeriod = "morning" | "day" | "evening";

export function greetingPeriod(d: Date): GreetingPeriod {
  const h = d.getHours();
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 18) return "day";
  return "evening";
}

export function friendsOnline(friends: Iterable<{ presence?: { status?: string } | null }>): number {
  let n = 0;
  for (const f of friends) if (f.presence?.status && f.presence.status !== "offline") n++;
  return n;
}

export function lastPlayedName(list: { name: string; last_played: number | null }[]): string | null {
  let best: { name: string; last_played: number | null } | null = null;
  for (const i of list) if (i.last_played && (!best || (best.last_played ?? 0) < i.last_played)) best = i;
  return best?.name ?? null;
}
