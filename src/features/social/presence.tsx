// Anzeige von Online-Status und Aktivität (Punkt, Text, Symbol, „seit …“).
import { Gamepad2, Globe2, Radio, Server } from "lucide-react";
import type { Activity, Presence } from "@/lib/vibe-sdk";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import { formatRelative } from "@/lib/format";

const DOT: Record<string, string> = {
  online: "bg-ok",
  busy: "bg-danger",
  away: "bg-warn",
  offline: "bg-[#4a4a52]",
};

/** Status-Punkt. `ring` = Farbe des Untergrunds (Ring trennt den Punkt vom Avatar). */
export function PresenceDot({ presence, className, size = 10, ring = "var(--canvas)" }: { presence: Presence | null | undefined; className?: string; size?: number; ring?: string }) {
  const s = presence?.status ?? "offline";
  const playing = s === "online" && (presence?.activity?.type === "playing" || presence?.activity?.type === "hosting");
  return (
    <span
      className={cn("inline-block shrink-0 rounded-dot", playing ? "bg-brand" : DOT[s], className)}
      style={{ width: size, height: size, boxShadow: `0 0 0 2px ${ring}` }}
    />
  );
}

export const isPlaying = (p: Presence | null | undefined) => !!p && p.status !== "offline" && (p.activity?.type === "playing" || p.activity?.type === "hosting");

/** Symbol zur Aktivität: Server, Welt, Instanz, Hosting. */
export function ActivityIcon({ activity, size = 13, className }: { activity: Activity | null | undefined; size?: number; className?: string }) {
  if (!activity) return null;
  const I = activity.type === "hosting" ? Radio : activity.server ? Server : activity.world && !activity.instanceName ? Globe2 : Gamepad2;
  return <I size={size} strokeWidth={2} className={cn("shrink-0", className)} aria-hidden />;
}

/** Laufzeit seit `iso` als „42 Min.“ / „2 Std. 5 Min.“. */
export function since(iso: string | null | undefined, t: (k: string, v?: Record<string, string | number>) => string): string | null {
  if (!iso) return null;
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 60) return t("social.dur.m", { m });
  const h = Math.floor(m / 60);
  return m % 60 ? t("social.dur.hm", { h, m: m % 60 }) : t("social.dur.h", { h });
}

/** Kurzer Statustext: „Spielt Survival · 1.21.1“, „Im Launcher“, „Hostet …“, „Abwesend“, „Offline“. */
export function usePresenceText() {
  const t = useT();
  return (p: Presence | null | undefined): string => {
    if (!p || p.status === "offline") return t("social.presence.offline");
    const a = p.activity;
    if (a?.type === "playing") {
      const v = [a.mcVersion, a.loader && a.loader !== "vanilla" ? loaderName(a.loader) : null].filter(Boolean).join(" ");
      const what = a.instanceName ?? a.server ?? a.world ?? "Minecraft";
      return v ? t("social.presence.playing_v", { name: what, version: v }) : t("social.presence.playing", { name: what });
    }
    if (a?.type === "hosting") return t("social.presence.hosting", { name: a.world ?? a.instanceName ?? "Server" });
    if (p.status === "away") return t("social.presence.away");
    if (p.status === "busy") return t("social.presence.busy");
    if (a?.type === "launcher") return t("social.presence.launcher");
    return t("social.presence.online");
  };
}

export function loaderName(l: string): string {
  return ({ fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt", vanilla: "Vanilla" } as Record<string, string>)[l] ?? l;
}

/** Aufgeteilte Aktivität für reichere Zeilen: Was (fett), Details (Version/Loader), seit wann. */
export function usePresenceParts() {
  const t = useT();
  const text = usePresenceText();
  return (p: Presence | null | undefined): { lead: string | null; what: string; detail: string | null; when: string | null } => {
    if (!p || p.status === "offline") return { lead: null, what: t("social.presence.offline"), detail: null, when: p?.updatedAt ? t("social.presence.last_seen", { time: formatRelative(p.updatedAt) }) : null };
    const a = p.activity;
    if (a && (a.type === "playing" || a.type === "hosting")) {
      const detail = [a.mcVersion, a.loader && a.loader !== "vanilla" ? loaderName(a.loader) : null].filter(Boolean).join(" · ") || null;
      const s = since(a.startedAt, t);
      return {
        lead: a.type === "hosting" ? t("social.presence.hosting_lead") : t("social.presence.playing_lead"),
        what: a.type === "hosting" ? (a.world ?? a.instanceName ?? "Server") : (a.instanceName ?? a.server ?? a.world ?? "Minecraft"),
        detail,
        when: s ? t("social.presence.since", { time: s }) : null,
      };
    }
    return { lead: null, what: text(p), detail: null, when: null };
  };
}
