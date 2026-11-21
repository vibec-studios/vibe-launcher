import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PlaySession } from "@/lib/types";

export function sumIn(sessions: PlaySession[], from: number, to = Infinity): number {
  let ms = 0;
  for (const s of sessions) ms += Math.max(0, Math.min(s.end, to) - Math.max(s.start, from));
  return ms / 1000;
}

export function useWeekPlaytime() {
  const monday = (() => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
  })();
  return useQuery({
    queryKey: ["playtime", "week", monday],
    queryFn: () => api.playtimeSessions(monday),
    select: (l) => sumIn(l, monday),
    staleTime: 60_000,
  });
}
