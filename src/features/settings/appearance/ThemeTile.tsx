import { Snowflake } from "lucide-react";
import { THEMES } from "@/lib/appearance";
import type { ThemeId } from "@/lib/types";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";

/** Theme-Kachel: kleine, statische Launcher-Skizze in den Farben des Themes. */
export function ThemeTile({ id, active, modified, onClick }: { id: ThemeId; active: boolean; modified: boolean; onClick: () => void }) {
  const t = useT();
  const th = THEMES[id];
  const sw = th.swatch;
  const ac = th.tokens.accent;
  const r = { square: 0, slight: 2, round: 4, custom: 3 }[th.tokens.radius];
  const light = th.tokens.tone === "light";
  const px = th.tokens.cards === "pixel";
  const edge =
    th.tokens.cards === "outlined" || light || px
      ? `inset 0 0 0 ${px ? 1.5 : 1}px ${light ? "rgb(10 12 18 / .14)" : "rgb(255 255 255 / .16)"}`
      : undefined;
  return (
    <button onClick={onClick} aria-pressed={active} className="group flex min-w-0 flex-col gap-1.5 text-left">
      <span
        className={cn(
          "relative block h-[66px] w-full overflow-hidden rounded-card shadow-[0_0_0_1px_var(--line-1)]",
          active ? "outline outline-2 outline-offset-2 outline-brand" : "group-hover:outline group-hover:outline-1 group-hover:outline-offset-2 group-hover:outline-white/25",
        )}
        style={{ background: sw.frame }}
      >
        <span className="absolute inset-y-0 left-0 flex w-4 flex-col items-center gap-1 pt-1.5">
          <span className="h-2 w-2" style={{ background: ac, borderRadius: r / 2 }} />
          <span className="h-2 w-2" style={{ background: sw.surface2, borderRadius: r / 2 }} />
          <span className="h-2 w-2" style={{ background: sw.surface2, borderRadius: r / 2 }} />
        </span>
        <span className="absolute bottom-0 left-4 right-0 top-2.5 flex flex-col gap-1 p-1.5" style={{ background: sw.canvas, borderTopLeftRadius: r }}>
          <span className="flex items-center gap-1 p-1" style={{ background: sw.surface, borderRadius: r, boxShadow: edge }}>
            <span
              className={th.tokens.headings === "pixel" ? "h-2 w-8" : "h-1.5 w-8"}
              style={{ background: sw.text, opacity: 0.85, borderRadius: th.tokens.headings === "pixel" ? 0 : r / 3 }}
            />
            <span className="ml-auto h-2.5 w-5" style={{ background: ac, borderRadius: r / 2, boxShadow: px ? "inset 0 -2px 0 rgb(0 0 0 / .3)" : undefined }} />
          </span>
          <span className="grid grid-cols-3 gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-3" style={{ background: sw.surface, borderRadius: r, boxShadow: edge }} />
            ))}
          </span>
          <span className="flex items-center gap-[3px]">
            <span className="h-1 w-6" style={{ background: sw.muted, opacity: 0.7, borderRadius: r / 3 }} />
            <span className="ml-auto h-1.5 w-1.5 rounded-full" style={{ background: th.tokens.status.ok }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: th.tokens.status.warn }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: th.tokens.status.danger }} />
          </span>
        </span>
        {th.tokens.cards === "pixel" && (
          <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-[14px] w-full" viewBox="0 0 60 7" preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden>
            <path d="M0 7V4h4V3h5v1h4V2h6v2h5V3h6V1h5v2h4v1h6V2h5v2h5v3z" fill={id === "pixel" ? "#2a1846" : "#d9d4ea"} />
          </svg>
        )}
        {id === "winter" && (
          // ein paar ruhende Flocken + Schneekante auf der Inhaltsfläche
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 120 66" preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden>
            <g fill="#eaf4ff">
              <rect x="30" y="5" width="1.5" height="1.5" opacity=".7" />
              <rect x="58" y="14" width="1" height="1" opacity=".5" />
              <rect x="84" y="4" width="2" height="2" opacity=".8" />
              <rect x="101" y="20" width="1" height="1" opacity=".5" />
              <rect x="70" y="36" width="1.5" height="1.5" opacity=".6" />
              <rect x="44" y="50" width="1" height="1" opacity=".5" />
              <rect x="110" y="44" width="1.5" height="1.5" opacity=".6" />
              <rect x="22" y="8" width="18" height="1" opacity=".55" />
              <rect x="48" y="8.5" width="26" height=".75" opacity=".4" />
              <rect x="90" y="8" width="14" height="1" opacity=".5" />
            </g>
          </svg>
        )}
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn("truncate text-[12.5px] font-medium", active ? "text-text" : "text-muted group-hover:text-text")}>{t(`ap.theme.${id}`)}</span>
        {id === "winter" && <Snowflake size={11} className="shrink-0 text-dim" />}
        {modified && <span className="ml-auto shrink-0 text-[11px] text-dim">{t("ap.theme.modified")}</span>}
      </span>
    </button>
  );
}
