import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queries";
import type { FeedEventType, FeedPreferences } from "@/lib/vibe-sdk";
import { requireClient, useSocial, vibeClient } from "@/features/social/service";

export const feedKeys = {
  prefs: ["vibe", "feed", "prefs"] as const,
  feed: ["vibe", "feed", "items"] as const,
};

export function useFeedPrefs() {
  const linked = useSocial((s) => s.linked);
  return useQuery({ queryKey: feedKeys.prefs, queryFn: () => requireClient().feedPreferences(), enabled: linked, staleTime: 60_000 });
}

export async function setFeedEnabled(enabled: boolean) {
  const next = await requireClient().setFeedPreferences(enabled);
  queryClient.setQueryData<FeedPreferences>(feedKeys.prefs, next);
  void queryClient.invalidateQueries({ queryKey: feedKeys.feed });
  return next;
}

export function useFeed() {
  const linked = useSocial((s) => s.linked);
  return useInfiniteQuery({
    queryKey: feedKeys.feed,
    enabled: linked,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => requireClient().feed({ limit: 20, before: pageParam }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

const SENT = "vl.feed.sent";

function sentToday(type: FeedEventType) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const m = JSON.parse(localStorage.getItem(SENT) ?? "{}") as Record<string, string>;
    if (m[type] === day) return true;
    m[type] = day;
    localStorage.setItem(SENT, JSON.stringify(m));
  } catch {
    /* egal */
  }
  return false;
}

export function publishFeedEvent(type: FeedEventType) {
  const c = vibeClient();
  if (!c || !useSocial.getState().linked) return;
  const prefs = queryClient.getQueryData<FeedPreferences>(feedKeys.prefs);
  if (prefs && !prefs.enabled) return;
  void (async () => {
    const p = prefs ?? (await c.feedPreferences().catch(() => null));
    if (!p?.enabled || sentToday(type)) return;
    await c.publishFeedEvent(type).catch(() => {});
  })();
}
