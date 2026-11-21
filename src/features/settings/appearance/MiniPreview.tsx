import { Backdrop } from "@/app/Backdrop";
import { Snowfall } from "@/app/Snowfall";
import { themeExtra } from "@/lib/appearance";
import type { Appearance } from "@/lib/types";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";

/**
 * Live-Vorschau: verkleinerter Launcher (Rahmen, Seitenleiste, Bühne, Kacheln). Liest dieselben CSS-Variablen wie
 * die App (der Entwurf ist global angewendet) und zeigt Theme-Extras: Schneefall, Robbe mit Schal, Frost.
 */
export function MiniPreview({ a }: { a: Appearance }) {
  const t = useT();
  const snow = themeExtra(a, "snow");
  const mascot = themeExtra(a, "mascot");
  const frost = themeExtra(a, "frost");
  const wide = a.sidebar.mode === "wide";
  return (
    <div className="relative h-[180px] w-[320px] shrink-0 overflow-hidden rounded-card bg-[var(--tone-frame)] shadow-[0_0_0_1px_var(--line-2)]" aria-label={t("ap.preview")}>
      <Backdrop appearance={a} contained />
      <div className="absolute inset-0 flex">
        <div
          className={cn(
            "flex shrink-0 flex-col gap-1.5 bg-bg pt-2",
            wide ? "w-[72px] items-stretch px-1.5" : "w-8 items-center",
            a.sidebar.style === "floating" && "my-1.5 ml-1.5 rounded-card bg-panel shadow-[0_0_0_1px_var(--line-1)]",
          )}
          style={a.sidebar.style === "tinted" ? { background: "color-mix(in srgb, var(--ui-accent) 11%, var(--frame))" } : undefined}
        >
          {mascot ? (
            <img src="/logo-seal-winter.png" alt="" className="h-5 w-5 self-center object-contain [image-rendering:pixelated]" />
          ) : (
            <span className="h-4 w-4 self-center rounded-xs bg-brand/80" />
          )}
          {a.sidebar.order
            .filter((k) => !a.sidebar.hidden.includes(k))
            .slice(0, 5)
            .map((k, i) => (
              <span key={k} className="flex items-center gap-1">
                <span className={cn("h-3.5 w-3.5 shrink-0 rounded-xs", i === 0 ? "bg-brand/70" : "bg-white/10")} />
                {wide && <span className="h-1.5 flex-1 rounded-xs bg-white/15" />}
              </span>
            ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className={cn("bg-bg", a.design === "v2" ? "h-6" : "h-5")} />
          <div
            className={cn(
              "flex flex-1 flex-col gap-2 bg-panel p-2.5",
              a.design === "v2" ? "mb-1.5 mr-1.5 rounded-card shadow-[0_0_0_1px_var(--line-1),0_4px_14px_rgb(0_0_0/0.25)]" : "rounded-tl-card",
            )}
          >
            <div className="relative flex items-center gap-2 overflow-hidden rounded-card bg-surface p-2">
              <span className="h-7 w-7 rounded-ctl bg-surface3" />
              <span className="flex flex-1 flex-col gap-1">
                <span className="h-2 w-20 rounded-xs bg-[var(--text-1)]" style={a.headings === "pixel" ? { borderRadius: 0, height: 7 } : undefined} />
                <span className="h-1.5 w-14 rounded-xs bg-[var(--text-3)]" />
              </span>
              <span className="h-5 w-12 rounded-ctl bg-brand" />
            </div>
            <div className={cn("grid gap-1.5", a.icon_size === "small" ? "grid-cols-5" : "grid-cols-4")}>
              {[0, 1, 2, 3, 4].slice(0, a.icon_size === "small" ? 5 : 4).map((i) => (
                <span key={i} className="flex flex-col gap-1">
                  <span className="aspect-[4/3] rounded-ctl bg-surface" />
                  <span className="h-1.5 w-3/4 rounded-xs bg-white/30" />
                </span>
              ))}
            </div>
            <div className="mt-auto flex items-center gap-1.5">
              <span className="h-4 w-14 rounded-ctl bg-surface2" />
              <span className="h-4 w-10 rounded-ctl bg-field" />
              <span className="ml-auto flex gap-1">
                <span className="h-2 w-2 rounded-dot bg-ok" />
                <span className="h-2 w-2 rounded-dot bg-warn" />
                <span className="h-2 w-2 rounded-dot bg-danger" />
              </span>
            </div>
          </div>
        </div>
      </div>
      {/* Mini-Dialog mit Frost oben rechts */}
      {frost && (
        <div className="absolute right-3 top-8 h-10 w-24 rounded-panel bg-overlay shadow-e3">
          <span
            className="absolute inset-0 opacity-70 [image-rendering:pixelated]"
            style={{ background: "var(--frost-l) left top / 60px 36px no-repeat, var(--frost-r) right top / 60px 36px no-repeat" }}
          />
          <span className="absolute left-2 top-2.5 h-1.5 w-10 rounded-xs bg-white/60" />
          <span className="absolute left-2 top-5 h-1 w-14 rounded-xs bg-white/20" />
        </div>
      )}
      {snow && <Snowfall contained amount={a.effects.snow_amount} settle={false} />}
    </div>
  );
}
