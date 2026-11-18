// MinecraftCapes (minecraftcapes.net): Backend-Aufrufe, Abfragen und Aufbereitung der Cape-Frames.
// Verhalten wie die offizielle Mod: animierte Capes = vertikal gestapelte Frames (Breite × Breite/2),
// 100 ms je Frame; statische Capes werden oben links in eine 64×32·2ⁿ-Fläche gesetzt.
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSettings } from "@/lib/queries";

export const MCCAPES_SITE = "https://minecraftcapes.net";

export interface McCapeLayout {
  width: number;
  height: number;
  frames: number;
  frame_width: number;
  frame_height: number;
  canvas_width: number;
  canvas_height: number;
  frame_ms: number;
}

export interface McProfile {
  account_id: string;
  cape: { data_url: string; layout: McCapeLayout } | null;
  ears: { data_url: string } | null;
  glint: boolean;
  upside_down: boolean;
  texture_error: boolean;
}

export type McUnsupported = "vanilla" | "no_version" | "offline";

export interface McModStatus {
  instance_id: string;
  installed: boolean;
  files: string[];
  version_number: string | null;
  unsupported: McUnsupported | null;
}

export const mcApi = {
  profile: (accountId: string | null) => invoke<McProfile>("mccapes_profile", { accountId }),
  modStatus: () => invoke<McModStatus[]>("mccapes_mod_status"),
  modSet: (instanceId: string, enabled: boolean) => invoke<string | null>("mccapes_mod_set", { instanceId, enabled }),
};

export const mcq = {
  profile: (accountId: string) => ["mccapes-profile", accountId] as const,
  mods: ["mccapes-mods"] as const,
};

/** Einstellung „MinecraftCapes anzeigen“ (Standard an). Solange die Einstellungen laden: aus (keine Anfrage). */
export function useMcCapesEnabled(): boolean {
  const s = useSettings().data;
  return s ? s.minecraftcapes !== false : false;
}

export function useMcProfile(accountId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: mcq.profile(accountId ?? "-"),
    queryFn: () => mcApi.profile(accountId),
    enabled: enabled && !!accountId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// ------------------------------------------------------------------ Frames

/** Fertig aufbereitete Cape-Frames für den 3D-Viewer und die 2D-Vorschau. */
export interface McCapeFrames {
  frames: HTMLCanvasElement[];
  frameMs: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Cape nicht ladbar"));
    img.src = src;
  });
}

export async function buildCapeFrames(dataUrl: string, layout: McCapeLayout): Promise<McCapeFrames> {
  const img = await loadImage(dataUrl);
  const frames: HTMLCanvasElement[] = [];
  for (let i = 0; i < layout.frames; i++) {
    const c = document.createElement("canvas");
    c.width = layout.canvas_width;
    c.height = layout.canvas_height;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, i * layout.frame_height, layout.frame_width, layout.frame_height, 0, 0, layout.frame_width, layout.frame_height);
    frames.push(c);
  }
  return { frames, frameMs: layout.frame_ms };
}

const frameCache = new Map<string, Promise<McCapeFrames>>();

export function useCapeFrames(cape: McProfile["cape"] | null | undefined): McCapeFrames | null {
  const [out, setOut] = useState<McCapeFrames | null>(null);
  const key = cape ? `${cape.layout.frames}|${cape.layout.frame_height}|${cape.data_url}` : null;
  useEffect(() => {
    if (!cape || !key) {
      setOut(null);
      return;
    }
    let p = frameCache.get(key);
    if (!p) {
      p = buildCapeFrames(cape.data_url, cape.layout);
      p.catch(() => frameCache.delete(key));
      frameCache.set(key, p);
      if (frameCache.size > 8) frameCache.delete(frameCache.keys().next().value!);
    }
    let dead = false;
    p.then(
      (f) => !dead && setOut(f),
      () => !dead && setOut(null),
    );
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return out;
}

/** Aktueller Frame-Index (läuft im Takt der Animation, 0 bei statischen Capes). */
export function useFrameIndex(frames: McCapeFrames | null, running = true): number {
  const [i, setI] = useState(0);
  const n = frames?.frames.length ?? 0;
  const ms = frames?.frameMs ?? 100;
  useEffect(() => {
    setI(0);
    if (n <= 1 || !running) return;
    const id = window.setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => window.clearInterval(id);
  }, [n, ms, running]);
  return n ? i % n : 0;
}

/** Cape-Vorderseite (10×16) eines Frames als Data-URL. */
export function capeFront(frame: HTMLCanvasElement, scale: number): string {
  const f = Math.max(1, frame.width / 64);
  const c = document.createElement("canvas");
  c.width = 10 * scale;
  c.height = 16 * scale;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(frame, 1 * f, 1 * f, 10 * f, 16 * f, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

/** Vorderseiten aller Frames (für die animierte 2D-Vorschau). */
export function useCapeFronts(frames: McCapeFrames | null, scale: number): string[] {
  const [out, setOut] = useState<string[]>([]);
  useEffect(() => {
    setOut(frames ? frames.frames.map((f) => capeFront(f, scale)) : []);
  }, [frames, scale]);
  return out;
}
