import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { Screenshot, ScreenshotList, ScreenshotVisibility } from "@/lib/vibe-sdk";
import { requireClient, useSocial, vibeClient } from "@/features/social/service";

export const shotKeys = {
  list: ["vibe", "screenshots"] as const,
  image: (url: string) => ["vibe", "image", url] as const,
};

const STORE = "vl.shots.uploaded";

function readMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export const useUploaded = create<{ byPath: Record<string, string> }>(() => ({ byPath: readMap() }));

function remember(path: string, id: string | null) {
  const next = { ...useUploaded.getState().byPath };
  if (id) next[path] = id;
  else delete next[path];
  useUploaded.setState({ byPath: next });
  try {
    localStorage.setItem(STORE, JSON.stringify(next));
  } catch {
    /* egal */
  }
}

function forgetId(id: string) {
  const entry = Object.entries(useUploaded.getState().byPath).find(([, v]) => v === id);
  if (entry) remember(entry[0], null);
}

export function useCloudShots(enabled = true) {
  const ready = useSocial((s) => s.linked);
  return useQuery({
    queryKey: shotKeys.list,
    queryFn: () => requireClient().listScreenshots({ limit: 100 }),
    enabled: enabled && ready,
    staleTime: 15_000,
  });
}

function patchList(fn: (l: ScreenshotList) => ScreenshotList) {
  queryClient.setQueryData<ScreenshotList>(shotKeys.list, (l) => (l ? fn(l) : l));
}

export async function uploadShot(path: string, visibility: ScreenshotVisibility): Promise<Screenshot> {
  const c = requireClient();
  const token = await c.accessToken();
  if (!token) throw new Error("unauthorized");
  const shot = (await api.vibeScreenshotUpload(path, visibility, token)) as Screenshot;
  remember(path, shot.id);
  patchList((l) => ({ ...l, screenshots: [shot, ...l.screenshots], usedBytes: l.usedBytes + shot.size }));
  void queryClient.invalidateQueries({ queryKey: shotKeys.list });
  return shot;
}

export async function setVisibility(id: string, visibility: ScreenshotVisibility): Promise<Screenshot> {
  const shot = await requireClient().setScreenshotVisibility(id, visibility);
  patchList((l) => ({ ...l, screenshots: l.screenshots.map((s) => (s.id === id ? shot : s)) }));
  return shot;
}

export async function deleteShot(id: string) {
  await requireClient().deleteScreenshot(id);
  forgetId(id);
  patchList((l) => {
    const gone = l.screenshots.find((s) => s.id === id);
    return { ...l, screenshots: l.screenshots.filter((s) => s.id !== id), usedBytes: Math.max(0, l.usedBytes - (gone?.size ?? 0)) };
  });
}

export function absUrl(path: string) {
  const base = vibeClient()?.baseUrl ?? "";
  return /^https?:/.test(path) ? path : base + path;
}

export function shareUrl(s: Screenshot): string | null {
  if (s.visibility === "link" && s.sharePath) return absUrl(s.sharePath);
  if (s.visibility === "friends") return absUrl(s.imagePath);
  return null;
}

export const SHOT_RE = /(https?:\/\/[^\s/]+)\/api\/v1\/screenshots\/([A-Za-z0-9_-]{1,64})\/image(?:\?key=([A-Za-z0-9_-]{43}))?/;

export function parseShotLink(text: string): { url: string; id: string; key?: string } | null {
  const m = text.match(SHOT_RE);
  if (!m) return null;
  return { url: m[0], id: m[2], key: m[3] };
}

export function withoutShotLink(text: string): string {
  return text.replace(SHOT_RE, "").trim();
}

export function useVibeImage(url: string | null | undefined) {
  return useQuery({
    queryKey: shotKeys.image(url ?? ""),
    enabled: !!url,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 0,
    queryFn: async () => {
      const full = absUrl(url!);
      const token = await vibeClient()?.accessToken().catch(() => null);
      return api.vibeImage(full, token ?? null);
    },
  });
}
