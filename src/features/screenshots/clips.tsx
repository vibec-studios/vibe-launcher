// Gemeinsame Clip-Bausteine: Liste (mit Ordner-Polling, solange die Ansicht offen ist), Anzeige-Helfer, Vorschaubild.
import { memo, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Film, Keyboard, Skull, Swords, Zap, Flame } from "lucide-react";
import { api } from "@/lib/api";
import { useEvent } from "@/lib/events";
import { imageSrc } from "@/lib/format";
import type { Clip } from "@/lib/types";
import { cn } from "@/components/ui";

export const clipsKey = ["clips", "all"] as const;

/** Alle Clips; solange gemountet, meldet das Backend neue/geänderte/gelöschte Clips per `clips://changed`. */
export function useClips() {
  const qc = useQueryClient();
  useEffect(() => {
    const renew = () => api.clipsWatch(true).catch(() => {});
    renew();
    const iv = window.setInterval(renew, 10_000);
    return () => {
      window.clearInterval(iv);
      api.clipsWatch(false).catch(() => {});
    };
  }, []);
  useEvent("clips://changed", () => qc.invalidateQueries({ queryKey: ["clips"] }));
  return useQuery({ queryKey: clipsKey, queryFn: () => api.clipsList(null), staleTime: 10_000, refetchOnWindowFocus: true });
}

export const AUTO_REASONS = new Set(["kill", "multikill", "clutch", "death"]);
const KNOWN = new Set(["hotkey", ...AUTO_REASONS]);

export function reasonKey(reason: string) {
  return KNOWN.has(reason) ? `clips.reason.${reason}` : "clips.reason.unknown";
}

export const reasonColor: Record<string, string | undefined> = {
  kill: "#ff6b6b",
  multikill: "#ff9a52",
  clutch: "#ffb547",
  death: "#c4c4cc",
};

export function ReasonIcon({ reason, size = 12 }: { reason: string; size?: number }) {
  switch (reason) {
    case "hotkey":
      return <Keyboard size={size} />;
    case "kill":
      return <Swords size={size} />;
    case "multikill":
      return <Flame size={size} />;
    case "clutch":
      return <Zap size={size} />;
    case "death":
      return <Skull size={size} />;
    default:
      return <Film size={size} />;
  }
}

/** 31967 -> "0:32" */
export function formatClipLength(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "–";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Ort ohne Ergänzungen: Server nur, wenn das Spiel ihn gespeichert hat (nie aus session.json auffüllen). */
export function clipWhere(c: Clip, t: (k: string) => string): string {
  if (c.mode === "multiplayer") return c.server ?? t("clips.mode.multiplayer");
  if (c.world) return c.world;
  if (c.mode === "singleplayer" || c.mode === "hosting") return t("clips.untitled_world");
  return c.server ?? t("clips.untitled");
}

export function clipName(c: Clip, t: (k: string) => string): string {
  return c.title?.trim() || clipWhere(c, t);
}

/** Vorschaubild des Spiels; fehlt es (oder lädt nicht), ein ruhiger Platzhalter. */
export const ClipThumb = memo(function ClipThumb({ clip, className }: { clip: Clip; className?: string }) {
  const src = imageSrc(clip.thumbnail_path);
  const [state, setState] = useState<"loading" | "ok" | "error">(src ? "loading" : "error");
  useEffect(() => setState(src ? "loading" : "error"), [src]);
  return (
    <div className={cn("overflow-hidden bg-surface2", className ?? "relative")}>
      {state === "loading" && <div className="skeleton absolute inset-0" />}
      {state === "error" ? (
        <div
          className="absolute inset-0 grid place-items-center text-dim"
          style={{ background: "radial-gradient(120% 90% at 30% 20%, rgba(255,255,255,.06), transparent 60%)" }}
        >
          <Film size={26} strokeWidth={1.5} />
        </div>
      ) : (
        src && (
          <img
            src={src}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            onLoad={() => setState("ok")}
            onError={() => setState("error")}
            className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-150", state === "ok" ? "opacity-100" : "opacity-0")}
          />
        )
      )}
    </div>
  );
});
