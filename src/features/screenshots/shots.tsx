// Gemeinsame Screenshot-Bausteine (Seite + Startseite): Liste, Vorschaubilder aus dem Backend-Cache.
import { memo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { api } from "@/lib/api";
import { useGameStore } from "@/lib/queries";
import { imageSrc } from "@/lib/format";
import { cn } from "@/components/ui";
import { create } from "zustand";
import { intlLocale } from "@/i18n/languages";

/** Beim Öffnen der Screenshots-Seite direkt dieses Bild in der Lightbox zeigen (z. B. von der Startseite). */
export const useShotFocus = create<{ path: string | null }>(() => ({ path: null }));
export const openShot = (path: string) => useShotFocus.setState({ path });

export const shotsKey = (instance?: string | null) => ["screenshots", instance ?? "all"] as const;

/** Läuft gerade ein Spiel? (dann wird die Liste sparsam nachgeladen – neue F2-Bilder erscheinen) */
function useAnyRunning() {
  return useGameStore((s) => {
    for (const k in s.states) if (s.states[k].state === "running") return true;
    return false;
  });
}

export function useScreenshots(instance?: string | null) {
  const running = useAnyRunning();
  return useQuery({
    queryKey: shotsKey(instance),
    queryFn: () => api.screenshotsList(instance ?? null),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: running ? 6_000 : false,
  });
}

/** Vorschaubild; wird erst beim Rendern (also nur für sichtbare Kacheln) erzeugt. */
export const ShotThumb = memo(function ShotThumb({ path, className }: { path: string; className?: string }) {
  const q = useQuery({ queryKey: ["shot-thumb", path], queryFn: () => api.screenshotThumb(path), staleTime: Infinity, gcTime: 30 * 60_000, retry: 0 });
  const [loaded, setLoaded] = useState(false);
  const src = imageSrc(q.data);
  return (
    <div className={cn("overflow-hidden bg-surface2", className ?? "relative")}>
      {!loaded && !q.isError && <div className="skeleton absolute inset-0" />}
      {q.isError ? (
        <div className="absolute inset-0 grid place-items-center text-dim">
          <ImageOff size={20} />
        </div>
      ) : (
        src && (
          <img
            src={src}
            alt=""
            draggable={false}
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-150", loaded ? "opacity-100" : "opacity-0")}
          />
        )
      )}
    </div>
  );
});

/** Datumsgruppe (Heute, Gestern, Diese Woche, dann Monat) – für Screenshots und Clips. */
export function bucket(ts: number, now: Date): { key: string; label: (t: (k: string) => string, lang: string) => string } {
  const d = new Date(ts);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return { key: "today", label: (t) => t("shots.today") };
  if (diff === 1) return { key: "yesterday", label: (t) => t("shots.yesterday") };
  if (diff < 7) return { key: "week", label: (t) => t("shots.week") };
  const key = `${d.getFullYear()}-${d.getMonth()}`;
  return {
    key,
    label: (_t, lang) => d.toLocaleDateString(intlLocale(lang), { month: "long", year: "numeric" }),
  };
}
