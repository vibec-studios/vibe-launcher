import { useEffect, useState } from "react";
import { Check, Pipette } from "lucide-react";
import { ACCENT_PRESETS, THEMES, THEME_IDS } from "@/lib/appearance";
import { Input, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";

export function AccentPicker({ value, onChange }: { value: string; onChange: (v: string, delay?: number) => void }) {
  const t = useT();
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const presets = [...new Set([...ACCENT_PRESETS, ...THEME_IDS.map((id) => THEMES[id].tokens.accent)])];
  const custom = !presets.includes(value.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((c) => {
        const active = c === value.toLowerCase();
        return (
          <button
            key={c}
            aria-label={c}
            aria-pressed={active}
            onClick={() => onChange(c)}
            className={cn("grid h-8 w-8 place-items-center rounded-ctl transition-transform duration-100 hover:scale-105", active && "outline outline-2 outline-offset-2 outline-white/80")}
            style={{ background: c }}
          >
            {active && <Check size={15} strokeWidth={3} className="text-black/70" />}
          </button>
        );
      })}
      <span className="mx-1 h-6 w-px bg-line2" />
      <Tooltip content={t("ap.accent.custom")}>
        <label
          className={cn(
            "relative grid h-8 w-8 cursor-pointer place-items-center rounded-ctl bg-surface3 text-muted hover:text-text",
            custom && "outline outline-2 outline-offset-2 outline-white/80",
          )}
          style={custom ? { background: value, color: "rgb(0 0 0 / .7)" } : undefined}
        >
          <Pipette size={14} />
          <input type="color" aria-label={t("ap.accent.custom")} value={value} onChange={(e) => onChange(e.target.value, 250)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
      </Tooltip>
      <Input
        aria-label={t("ap.accent.custom")}
        value={hex}
        maxLength={7}
        onChange={(e) => {
          const v = e.target.value.trim();
          setHex(v);
          if (/^#?[0-9a-f]{6}$/i.test(v)) onChange((v.startsWith("#") ? v : `#${v}`).toLowerCase(), 400);
        }}
        className="w-[108px] font-mono text-[12.5px] [&_input]:h-8"
        leading={<span className="block h-3 w-3 rounded-xs" style={{ background: value }} />}
      />
    </div>
  );
}
