import { useEffect, useMemo, type CSSProperties } from "react";
import { Gamepad2, Home, Layers, Play, Settings } from "lucide-react";
import type { ThemeDoc } from "@/lib/customThemes";
import { compileTheme } from "@/lib/themes/compile";
import { baseSwatch, onAccentFor } from "@/lib/themes/palette";
import type { SlotName } from "@/lib/themes/rules";
import { Button, Progress, Tag, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { setThemeStyle } from "./dom";
import { SlotView } from "./ThemeSlot";

const STYLE_ID = "vl-theme-preview-css";
const LAYER: SlotName[] = ["background", "corner-tl", "corner-tr", "corner-bl", "corner-br"];
const SCALE = 0.62;

function previewVars(doc: ThemeDoc): CSSProperties {
  const p = doc.palette;
  const sw = baseSwatch(doc.values);
  const v = doc.values;
  const on = p.on_accent ?? onAccentFor(v.accent);
  const light = v.tone === "light";
  return {
    "--ink": light ? "#0b0d12" : "#fff",
    "--frame": p.frame ?? sw.frame,
    "--canvas": p.canvas ?? sw.canvas,
    "--surface-1": p.surface ?? sw.surface,
    "--surface-2": p.surface2 ?? sw.surface2,
    "--surface-3": p.surface3 ?? `color-mix(in oklab, ${p.surface2 ?? sw.surface2}, ${light ? "#000" : "#fff"} 6%)`,
    "--overlay": p.overlay ?? p.surface ?? sw.surface,
    "--text-1": p.text ?? sw.text,
    "--text-2": p.muted ?? sw.muted,
    "--text-3": p.dim ?? sw.muted,
    ...(p.border ? { "--line-1": p.border } : {}),
    ...(p.border2 ? { "--line-2": p.border2 } : {}),
    ...(p.field ? { "--field": p.field } : {}),
    "--ui-accent": v.accent,
    "--accent": v.accent,
    "--ui-on-accent": on,
    "--on-accent": on,
    "--ui-ok": v.status.ok,
    "--ui-warn": v.status.warn,
    "--ui-danger": v.status.danger,
    background: p.frame ?? sw.frame,
    color: p.text ?? sw.text,
  } as CSSProperties;
}

export function ThemePreview({ doc }: { doc: ThemeDoc }) {
  const t = useT();
  const compiled = useMemo(() => compileTheme(doc, "preview"), [doc]);
  useEffect(() => {
    setThemeStyle(STYLE_ID, compiled.css || null);
    return () => setThemeStyle(STYLE_ID, null);
  }, [compiled]);
  const slot = (name: SlotName, className?: string) => {
    const nodes = compiled.slots[name];
    return nodes ? <SlotView key={name} name={name} nodes={nodes} placeholders={compiled.placeholders} className={className} /> : null;
  };
  return (
    <div
      data-vt-lock=""
      data-vt-preview=""
      aria-label={t("vt.import.preview")}
      className="relative isolate h-[260px] w-full overflow-hidden rounded-card shadow-[0_0_0_1px_var(--line-2)] [contain:paint]"
      style={previewVars(doc)}
    >
      <div className="flex origin-top-left text-[13px]" style={{ width: `${100 / SCALE}%`, height: `${100 / SCALE}%`, transform: `scale(${SCALE})` }}>
        <div data-part="sidebar" className="flex w-[60px] shrink-0 flex-col items-center gap-1.5 bg-bg py-2">
          {slot("sidebar-top")}
          {[Home, Layers, Gamepad2].map((Icon, i) => (
            <button key={i} type="button" tabIndex={-1} data-part="nav-item" aria-current={i === 0 ? "page" : undefined} className={cn("grid h-8 w-8 place-items-center rounded-ctl", i === 0 ? "bg-white/[.08] text-brand" : "text-muted")}>
              <Icon size={15} />
            </button>
          ))}
          <Settings size={14} className="mt-auto text-dim" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div data-part="header" className="h-11 shrink-0 bg-bg" />
          <div data-part="main" className="relative isolate min-h-0 flex-1 overflow-hidden rounded-tl-card bg-panel">
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
              {LAYER.map((n) => slot(n))}
            </div>
            <div data-part="home" className="flex h-full flex-col gap-4 overflow-hidden p-5">
              {slot("home-hero")}
              <div data-part="home-header" className="text-title text-text">
                {t("vt.preview.title")}
              </div>
              <div data-part="home-hero card" className="flex items-center gap-4 rounded-panel bg-surface p-4">
                <span className="h-12 w-12 shrink-0 rounded-ctl bg-surface3" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px] font-bold text-text">{t("vt.preview.instance")}</span>
                  <span className="block truncate text-meta text-dim">{t("vt.preview.meta")}</span>
                </span>
                <Button variant="primary" tabIndex={-1} icon={<Play size={14} />}>
                  {t("vt.preview.play")}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="ghost" tabIndex={-1}>
                  {t("vt.preview.secondary")}
                </Button>
                <Button size="sm" variant="subtle" tabIndex={-1}>
                  {t("vt.preview.subtle")}
                </Button>
                <Tag>Fabric</Tag>
                <span className="ml-auto flex gap-1">
                  <span className="h-2 w-2 rounded-dot bg-ok" />
                  <span className="h-2 w-2 rounded-dot bg-warn" />
                  <span className="h-2 w-2 rounded-dot bg-danger" />
                </span>
              </div>
              <Progress value={0.62} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
