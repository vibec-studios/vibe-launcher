import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { Appearance } from "@/lib/types";
import { IconButton, Input, Slider, cn } from "@/components/ui";
import { useT } from "@/i18n";

type Bg = Appearance["background"];
type SetBg = (p: Partial<Bg>, delay?: number) => void;

const COLOR_PRESETS = ["#0d0818", "#170e26", "#0e1629", "#0b1f23", "#1c1734", "#101014", "#1a1206", "#f5f4f1"];
const GRADIENT_PRESETS: [string, string, number][] = [
  ["#170e26", "#ff9e6d", 170],
  ["#0e1629", "#a9d3ff", 160],
  ["#0b1f23", "#ffd774", 165],
  ["#1c1734", "#ffb6d2", 160],
  ["#05060a", "#3a2b8f", 135],
  ["#0a1a12", "#3fe0c5", 150],
];

export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string, delay?: number) => void; label: string }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <div className="flex items-center gap-2">
      <label className="relative grid h-8 w-8 shrink-0 cursor-pointer rounded-ctl shadow-[inset_0_0_0_1px_var(--line-2)]" style={{ background: value }}>
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value.toLowerCase(), 250)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <Input
        aria-label={label}
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

function Swatch({ bg, active, onClick, label }: { bg: string; active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn("h-8 w-8 rounded-ctl shadow-[inset_0_0_0_1px_var(--line-2)]", active && "outline outline-2 outline-offset-2 outline-brand")}
      style={{ background: bg }}
    />
  );
}

export function SolidColorEditor({ b, setBg }: { b: Bg; setBg: SetBg }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {COLOR_PRESETS.map((c) => (
        <Swatch key={c} bg={c} label={c} active={b.color === c} onClick={() => setBg({ color: c })} />
      ))}
      <span className="mx-1 h-6 w-px bg-line2" />
      <ColorInput label={t("bge.color")} value={b.color} onChange={(color, d) => setBg({ color }, d)} />
    </div>
  );
}

export function GradientEditor({ b, setBg }: { b: Bg; setBg: SetBg }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {GRADIENT_PRESETS.map(([from, to, angle]) => (
          <Swatch
            key={from + to}
            label={`${from} → ${to}`}
            bg={`linear-gradient(${angle}deg, ${from}, ${to})`}
            active={b.gradient_from === from && b.gradient_to === to}
            onClick={() => setBg({ gradient_from: from, gradient_to: to, gradient_angle: angle })}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ColorInput label={t("bge.from")} value={b.gradient_from} onChange={(gradient_from, d) => setBg({ gradient_from }, d)} />
        <IconButton label={t("bge.swap")} tip size="sm" variant="ghost" onClick={() => setBg({ gradient_from: b.gradient_to, gradient_to: b.gradient_from })}>
          <ArrowLeftRight size={14} />
        </IconButton>
        <ColorInput label={t("bge.to")} value={b.gradient_to} onChange={(gradient_to, d) => setBg({ gradient_to }, d)} />
      </div>
      <div className="flex w-[300px] max-w-full items-center gap-3">
        <span className="shrink-0 text-[12.5px] text-muted">{t("bge.angle")}</span>
        <Slider value={b.gradient_angle} min={0} max={360} step={5} onChange={(gradient_angle) => setBg({ gradient_angle }, 200)} />
        <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted">{b.gradient_angle}°</span>
      </div>
    </div>
  );
}
