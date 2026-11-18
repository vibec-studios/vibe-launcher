// Anzeige von Online-Status und Aktivität (Punkt, Text).
import type { Presence } from "@/lib/vibe-sdk";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";

const DOT: Record<string, string> = {
  online: "bg-ok",
  busy: "bg-danger",
  away: "bg-warn",
  offline: "bg-dim/60",
};

export function PresenceDot({ presence, className }: { presence: Presence | null | undefined; className?: string }) {
  const s = presence?.status ?? "offline";
  const playing = s !== "offline" && (presence?.activity?.type === "playing" || presence?.activity?.type === "hosting");
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 border-2 border-black", playing ? "bg-brand" : DOT[s], className)} />;
}

/** Kurzer Statustext: „Spielt Survival · 1.21.1“, „Im Launcher“, „Hostet …“, „Abwesend“, „Offline“. */
export function usePresenceText() {
  const t = useT();
  return (p: Presence | null | undefined): string => {
    if (!p || p.status === "offline") return t("social.presence.offline");
    const a = p.activity;
    if (a?.type === "playing") {
      const v = [a.mcVersion, a.loader && a.loader !== "vanilla" ? a.loader : null].filter(Boolean).join(" ");
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
