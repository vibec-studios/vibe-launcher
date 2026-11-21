import { useEffect, useState } from "react";
import { Input, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { isHex, normalizeHex } from "./pixels";
import type { SkinEditor } from "./useSkinEditor";

const PALETTE = [
  "#f6d7c3", "#e8b896", "#d9a77f", "#c58c64", "#8d5a3b", "#5a3825",
  "#f2e27a", "#c98e3f", "#6b4428", "#3a2a1a", "#1d1d22", "#b8b8c0",
  "#ffffff", "#9aa0a8", "#5c616b", "#2f2f36", "#000000", "#7a4a3a",
  "#e5484d", "#f08c2e", "#f5c542", "#46a758", "#2a7f62", "#4f8a8b",
  "#3fb5c9", "#3b82f6", "#3d4a6b", "#7c5cff", "#c264d6", "#f47fb4",
];

function Swatch({ hex, active, onClick }: { hex: string; active: boolean; onClick: () => void }) {
  return (
    <Tooltip content={hex} delay={400}>
      <button
        type="button"
        aria-label={hex}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          "h-7 w-full rounded-xs ring-1 ring-inset ring-black/25 transition-transform duration-100 hover:scale-110",
          active && "outline outline-2 outline-offset-1 outline-text",
        )}
        style={{ background: hex }}
      />
    </Tooltip>
  );
}

export function ColorPanel({ ed }: { ed: SkinEditor }) {
  const t = useT();
  const [hex, setHex] = useState(ed.color);
  useEffect(() => setHex(ed.color), [ed.color]);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-section text-muted">{t("skined.color")}</div>
      <div className="flex items-center gap-2">
        <Tooltip content={t("skined.color_pick")}>
          <label className="relative block h-11 w-14 shrink-0 cursor-pointer overflow-hidden rounded-ctl ring-1 ring-inset ring-black/25" style={{ background: ed.color }}>
            <input
              type="color"
              aria-label={t("skined.color_pick")}
              value={ed.color}
              onChange={(e) => ed.setColor(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </Tooltip>
        <Input
          aria-label={t("skined.hex")}
          value={hex}
          maxLength={7}
          invalid={!isHex(hex)}
          onChange={(e) => {
            setHex(e.target.value);
            if (isHex(e.target.value) && e.target.value.replace("#", "").length === 6) ed.setColor(normalizeHex(e.target.value));
          }}
          onBlur={() => (isHex(hex) ? ed.setColor(normalizeHex(hex)) : setHex(ed.color))}
          className="min-w-0 flex-1 font-mono"
        />
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {PALETTE.map((c) => (
          <Swatch key={c} hex={c} active={ed.color === c && ed.tool !== "eraser"} onClick={() => ed.setColor(c)} />
        ))}
      </div>
      {ed.recent.length > 0 && (
        <>
          <div className="mt-1 text-meta text-dim">{t("skined.recent")}</div>
          <div className="grid grid-cols-6 gap-1.5">
            {ed.recent.slice(0, 6).map((c) => (
              <Swatch key={c} hex={c} active={false} onClick={() => ed.setColor(c)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
