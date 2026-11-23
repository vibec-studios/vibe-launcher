import { useState } from "react";
import { Check, ClipboardCopy, FileDown, MoreHorizontal, Pencil, Save, Sparkles, Trash2 } from "lucide-react";
import type { CustomTheme } from "@/lib/types";
import { THEMES } from "@/lib/appearance";
import { DropdownItem, DropdownMenu, DropdownSeparator, IconButton, cn } from "@/components/ui";
import { useT } from "@/i18n";

export interface TileActions {
  onApply: () => void;
  onRename: (name: string) => void;
  onOverwrite: () => void;
  onCopy: () => void;
  onSaveFile: () => void;
  onDelete: () => void;
}

function swatchOf(ct: CustomTheme) {
  const v = ct.values;
  const base = THEMES[v.theme] ?? THEMES.standard;
  const light = v.tone === "light";
  const baseSw = (base.tokens.tone === "light") === light ? base.swatch : THEMES[light ? "light" : "standard"].swatch;
  const p = ct.palette ?? {};
  const sw = { frame: p.frame ?? baseSw.frame, canvas: p.canvas ?? baseSw.canvas, surface: p.surface ?? baseSw.surface, surface2: p.surface2 ?? baseSw.surface2, text: p.text ?? baseSw.text, muted: p.muted ?? baseSw.muted };
  const r = v.cards === "pixel" ? 0 : v.radius === "custom" ? Math.min(6, v.radius_px / 3) : { square: 0, slight: 2, round: 4 }[v.radius];
  return { sw, r, accent: v.accent, pixel: v.cards === "pixel", status: v.status, light };
}

export function CustomThemeTile({ theme, active, modified, ...act }: { theme: CustomTheme; active: boolean; modified: boolean } & TileActions) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(theme.name);
  const { sw, r, accent, pixel, status, light } = swatchOf(theme);
  const edge = pixel ? `inset 0 0 0 1.5px ${light ? "rgb(24 22 30 / .2)" : "rgb(255 255 255 / .18)"}` : undefined;
  const commit = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== theme.name) act.onRename(name);
    else setName(theme.name);
  };
  return (
    <div className="group flex min-w-0 flex-col gap-1.5">
      <button
        onClick={act.onApply}
        aria-pressed={active}
        aria-label={theme.name}
        className={cn(
          "relative block h-[66px] w-full overflow-hidden rounded-card text-left shadow-[0_0_0_1px_var(--line-1)]",
          active ? "outline outline-2 outline-offset-2 outline-brand" : "hover:outline hover:outline-1 hover:outline-offset-2 hover:outline-white/25",
        )}
        style={{ background: sw.frame }}
      >
        <span className="absolute inset-y-0 left-0 flex w-4 flex-col items-center gap-1 pt-1.5">
          <span className="h-2 w-2" style={{ background: accent, borderRadius: r / 2 }} />
          <span className="h-2 w-2" style={{ background: sw.surface2, borderRadius: r / 2 }} />
        </span>
        <span className="absolute bottom-0 left-4 right-0 top-2.5 flex flex-col gap-1 p-1.5" style={{ background: sw.canvas, borderTopLeftRadius: r }}>
          <span className="flex items-center gap-1 p-1" style={{ background: sw.surface, borderRadius: r, boxShadow: edge }}>
            <span className={pixel ? "h-2 w-8" : "h-1.5 w-8"} style={{ background: sw.text, opacity: 0.85, borderRadius: pixel ? 0 : r / 3 }} />
            <span className="ml-auto h-2.5 w-5" style={{ background: accent, borderRadius: r / 2, boxShadow: pixel ? "inset 0 -2px 0 rgb(0 0 0 / .3)" : undefined }} />
          </span>
          <span className="flex items-center gap-[3px]">
            <span className="h-1 w-6" style={{ background: sw.muted, opacity: 0.7 }} />
            <span className="ml-auto h-1.5 w-1.5 rounded-full" style={{ background: status.ok }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.warn }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.danger }} />
          </span>
        </span>
        {theme.ext && (
          <span title={t("vt.badge")} className="absolute bottom-1 right-1 grid h-4 w-4 place-items-center rounded-xs bg-black/45 text-white">
            <Sparkles size={10} />
          </span>
        )}
        {active && (
          <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-xs bg-brand text-[var(--ui-on-accent)]">
            <Check size={11} strokeWidth={3} />
          </span>
        )}
      </button>
      <div className="flex min-w-0 items-center gap-1">
        {editing ? (
          <input
            autoFocus
            data-esc-local
            spellCheck={false}
            aria-label={t("ct.rename")}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                e.stopPropagation();
                setName(theme.name);
                setEditing(false);
              }
            }}
            className="vl-field h-7 min-w-0 flex-1 rounded-ctl border border-line2 bg-field px-2 text-[12.5px] text-text outline-none focus:border-brand"
          />
        ) : (
          <button onDoubleClick={() => setEditing(true)} onClick={act.onApply} className={cn("min-w-0 flex-1 truncate text-left text-[12.5px] font-medium", active ? "text-text" : "text-muted hover:text-text")}>
            {theme.name}
          </button>
        )}
        {modified && !editing && <span role="img" aria-label={t("ap.theme.modified")} title={t("ap.theme.modified")} className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />}
        <DropdownMenu
          trigger={
            <IconButton label={t("ct.actions", { name: theme.name })} size="sm" variant="ghost" className="h-6 w-6 shrink-0">
              <MoreHorizontal size={14} />
            </IconButton>
          }
        >
          <DropdownItem icon={<Pencil size={14} />} onSelect={() => setEditing(true)}>
            {t("ct.rename")}
          </DropdownItem>
          <DropdownItem icon={<Save size={14} />} onSelect={act.onOverwrite}>
            {t("ct.overwrite")}
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<ClipboardCopy size={14} />} onSelect={act.onCopy}>
            {t("ct.copy_code")}
          </DropdownItem>
          <DropdownItem icon={<FileDown size={14} />} onSelect={act.onSaveFile}>
            {t("ct.save_file")}
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<Trash2 size={14} />} danger onSelect={act.onDelete}>
            {t("ct.delete")}
          </DropdownItem>
        </DropdownMenu>
      </div>
    </div>
  );
}
