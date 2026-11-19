// Bausteine für Einstellungsseiten: Gruppe (Überschrift über einer Fläche), Zeile (Titel + Beschreibung + Steuerung),
// Zahleneingabe mit Einheit.
import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { cn } from "./cn";

export const SettingsCard = forwardRef<
  HTMLElement,
  { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string; danger?: boolean; id?: string }
>(function SettingsCard({ title, right, children, className, danger, id }, ref) {
  return (
    <section ref={ref} id={id} className={cn("flex flex-col gap-2", className)}>
      <header className="flex min-h-7 items-center gap-3 px-1">
        <h3 className={cn("flex-1 text-[12.5px] font-semibold", danger ? "text-danger" : "text-muted")}>{title}</h3>
        {right}
      </header>
      <div className={cn("rounded-card bg-surface", danger && "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_30%,transparent)]")}>{children}</div>
    </section>
  );
});

export function SettingRow({
  title,
  description,
  children,
  className,
  stacked,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Steuerung unter statt neben dem Text (für breite Eingaben) */
  stacked?: boolean;
  /** Optionales Bild/Symbol links neben Titel und Beschreibung (z. B. Avatar) */
  icon?: ReactNode;
}) {
  const text = (
    <div className="min-w-0 flex-1">
      <div className="text-[13.5px] font-medium text-text">{title}</div>
      {description && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{description}</div>}
    </div>
  );
  return (
    <div className={cn("flex gap-x-8 gap-y-2.5 border-line px-4 py-3 [&+&]:border-t", stacked ? "flex-col" : "items-center", className)}>
      {icon ? (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="shrink-0">{icon}</div>
          {text}
        </div>
      ) : (
        text
      )}
      {children !== undefined && <div className={cn("min-w-0", stacked ? "w-full" : "shrink-0")}>{children}</div>}
    </div>
  );
}

/** Zahlenfeld, das erst beim Verlassen/Enter übernimmt und auf min/max begrenzt. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  className,
  disabled,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const raw = text.trim();
    if (raw === "") {
      if (placeholder !== undefined) onChange(null);
      else setText(value === null ? "" : String(value));
      return;
    }
    let n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n)) return setText(value === null ? "" : String(value));
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    n = Math.round(n / step) * step;
    setText(String(n));
    if (n !== value) onChange(n);
  };
  return (
    <div className={cn("relative flex items-center", className)}>
      <input
        inputMode="numeric"
        spellCheck={false}
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => setText(e.target.value.replace(/[^\d.,-]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = value ?? min ?? 0;
            let n = base + (e.key === "ArrowUp" ? step : -step);
            if (min !== undefined) n = Math.max(min, n);
            if (max !== undefined) n = Math.min(max, n);
            onChange(n);
          }
        }}
        className={cn(
          "h-9 w-full rounded-ctl border border-transparent bg-field px-3 font-mono text-[13px] text-text outline-none transition-colors duration-150 placeholder:text-dim",
          "hover:bg-white/[.07] focus:border-accent/70 disabled:opacity-50",
          unit && "pr-10",
        )}
      />
      {unit && <span className="pointer-events-none absolute right-3 text-[12px] text-dim">{unit}</span>}
    </div>
  );
}
