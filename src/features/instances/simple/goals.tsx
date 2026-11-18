// Ziele des geführten „Neues Spiel“-Assistenten (Simple-Modus): Der Nutzer wählt, was er vorhat – der Launcher
// wählt Version, Mod-Unterbau und Zusätze selbst. `usePlan` rechnet ein Ziel in eine konkrete Einrichtung um.
import { useQuery } from "@tanstack/react-query";
import { Gauge, Puzzle, Sparkles, Sprout, Users } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { useGameVersions } from "@/lib/queries";
import type { LoaderKind } from "@/lib/types";
import { cn } from "@/components/ui";
import { useLoaderGameVersions, useLoaderVersions, pickLoaderVersion } from "@/components/instance/VersionPicker";
import type { NewGameGoal } from "@/components/instance/actions";
import { cpk } from "@/features/instances/settings/ClientPacks";
import { useVibe } from "@/lib/vibe";
import { useT } from "@/i18n";

export type { NewGameGoal };

/** Modrinth-ID von Sodium: bestimmt die Version für „Mehr FPS“ (neueste Version, für die es Sodium gibt). */
const SODIUM = "AANobbMI";

export const GOAL_ICONS: Record<NewGameGoal, ReactNode> = {
  vanilla: <Sprout size={22} />,
  fps: <Gauge size={22} />,
  mods: <Puzzle size={22} />,
  friends: <Users size={22} />,
  vibey: <Sparkles size={22} />,
};

/** Sichtbare Ziele (Vibey Client nur mit Vibe). */
export function useGoals(): NewGameGoal[] {
  const vibe = useVibe();
  return ["vanilla", "fps", "mods", "friends", ...(vibe.enabled ? (["vibey"] as const) : [])];
}

/** Große Kacheln „Neues Spiel“ (Startseite, Assistent, Onboarding). */
export function GoalTiles({ onPick, compact, cols, className }: { onPick: (g: NewGameGoal) => void; compact?: boolean; cols?: number; className?: string }) {
  const t = useT();
  const goals = useGoals();
  return (
    <div
      className={cn("grid gap-3", !cols && (compact ? "grid-cols-[repeat(auto-fit,minmax(140px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(176px,1fr))]"), className)}
      style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
    >
      {goals.map((g) => (
        <button
          key={g}
          data-tour={g === "vanilla" ? "new-game" : undefined}
          onClick={() => onPick(g)}
          className={cn(
            "vl-card group flex min-w-0 flex-col items-start gap-3 rounded-panel bg-surface text-left transition-colors duration-100 hover:bg-surface2",
            compact ? "p-4" : "p-5",
            g === "vibey" && "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ui-accent)_45%,transparent)]",
          )}
        >
          <span
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-card bg-black/40 transition-colors duration-100",
              g === "vibey" ? "text-brand" : "text-muted group-hover:text-text",
            )}
          >
            {GOAL_ICONS[g]}
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold text-text">{t(`goal.${g}`)}</span>
            <span className="mt-1 block text-[12.5px] leading-snug text-muted">{t(`goal.${g}.desc`)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export interface GamePlan {
  mc: string | null;
  loader: LoaderKind;
  loaderVersion: string | null;
  /** Client-Pack, das nach dem Anlegen installiert wird */
  pack: "vibey" | "essential" | null;
  /** Bewährte Performance-Mods installieren */
  perf: boolean;
  loading: boolean;
  /** Ziel gerade nicht umsetzbar (z. B. Vibey Client nicht erreichbar) */
  unavailable: boolean;
}

/** Ziel -> Einrichtung: neueste passende Minecraft-Version, Unterbau automatisch. */
export function usePlan(goal: NewGameGoal | null): GamePlan {
  const modded = !!goal && goal !== "vanilla";
  const versions = useGameVersions();
  const fabric = useLoaderGameVersions(modded ? "fabric" : "vanilla");
  const releases = (versions.data ?? []).filter((v) => v.kind === "release").map((v) => v.id);
  const fabricSet = new Set(fabric.data ?? []);
  const candidates = modded ? releases.filter((v) => fabricSet.has(v)) : releases;
  const newest = candidates[0] ?? null;

  const packId = goal === "vibey" ? "vibey" : goal === "friends" ? "essential" : null;
  const packs = useQuery({
    queryKey: cpk.plan(newest ?? "", "fabric"),
    queryFn: () => api.clientPacksList({ mcVersion: newest!, loader: "fabric" }),
    enabled: !!packId && !!newest,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const sodium = useQuery({
    queryKey: ["simple-plan", "sodium"],
    queryFn: () => api.contentProject("modrinth", SODIUM),
    enabled: goal === "fps",
    staleTime: 30 * 60_000,
    retry: 0,
  });

  let mc: string | null = newest;
  let pack: GamePlan["pack"] = null;
  let unavailable = false;
  let loader: LoaderKind = modded ? "fabric" : "vanilla";
  // Ohne passendes Pack: „Mit Freunden“ wird ein Spiel ohne Mods (läuft auf jedem Server), Vibey ist nicht möglich
  const noPack = () => {
    if (goal === "vibey") unavailable = true;
    else {
      loader = "vanilla";
      mc = releases[0] ?? null;
    }
  };
  if (packId && newest && packs.data) {
    const offer = packs.data.packs.find((p) => p.id === packId);
    const fits = !offer
      ? null
      : offer.available === true
        ? newest
        : offer.reason === "version"
          ? (candidates.find((v) => offer.mc_versions.includes(v)) ?? null)
          : null;
    if (fits) {
      mc = fits;
      pack = packId;
    } else noPack();
  } else if (packId && (packs.isError || (!newest && !fabric.isLoading && !versions.isLoading))) noPack();
  if (goal === "fps" && sodium.data) mc = candidates.find((v) => sodium.data.game_versions.includes(v)) ?? newest;

  const lv = useLoaderVersions(loader, loader === "vanilla" ? null : mc);
  const loaderVersion = loader === "vanilla" ? null : pickLoaderVersion(lv.data);

  const loading =
    !goal ||
    versions.isLoading ||
    (modded && fabric.isLoading) ||
    (!!packId && !!newest && packs.isLoading) ||
    (goal === "fps" && sodium.isLoading) ||
    (loader !== "vanilla" && !!mc && lv.isLoading);

  return { mc, loader, loaderVersion, pack, perf: goal === "fps", loading, unavailable };
}
