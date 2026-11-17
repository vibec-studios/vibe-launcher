// Schalter, Regler, Fortschritt, Chips, Skeletons, Leer-/Fehlerzustände.
import * as Sw from "@radix-ui/react-switch";
import * as Sl from "@radix-ui/react-slider";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "./cn";
import { Button } from "./Button";
import { t } from "@/i18n";

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <Sw.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-5 w-9 shrink-0 border border-line2 bg-surface transition-colors duration-150 data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-45"
    >
      <Sw.Thumb className="block h-3 w-3 translate-x-[3px] bg-muted transition-transform duration-150 data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-white" />
    </Sw.Root>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Sl.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => onChange(v[0])}
      className={cn("relative flex h-5 w-full touch-none select-none items-center", className)}
    >
      <Sl.Track className="relative h-1 grow bg-white/10">
        <Sl.Range className="absolute h-full bg-accent" />
      </Sl.Track>
      <Sl.Thumb className="block h-4 w-4 border-2 border-accent bg-black outline-none transition-transform duration-100 hover:scale-110 focus-visible:scale-110" />
    </Sl.Root>
  );
}

/** Fortschrittsbalken. `value = null` -> unbestimmt. */
export function Progress({ value, className, tone = "accent" }: { value: number | null; className?: string; tone?: "accent" | "danger" | "ok" }) {
  const color = tone === "danger" ? "bg-danger" : tone === "ok" ? "bg-ok" : "bg-accent";
  return (
    <div className={cn("relative h-1 w-full overflow-hidden bg-white/[.08]", className)} role="progressbar" aria-valuenow={value ?? undefined}>
      {value === null ? (
        <div className={cn("absolute inset-y-0 w-2/5", color)} style={{ animation: "indeterminate 1.1s var(--ease-snap) infinite" }} />
      ) : (
        <div className={cn("h-full transition-[width] duration-150 ease-linear", color)} style={{ width: `${Math.round(value * 1000) / 10}%` }} />
      )}
    </div>
  );
}

export function Chip({ children, active, onClick, className }: { children: ReactNode; active?: boolean; onClick?: () => void; className?: string }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 border px-2.5 font-mono text-[11px] transition-colors duration-150",
        active ? "border-accent bg-accent text-[var(--on-accent)]" : "border-line2 text-text",
        onClick && !active && "hover:border-accent",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Kleines Etikett (Loader, Version, Status). */
export function Tag({ children, className, color }: { children: ReactNode; className?: string; color?: string }) {
  return (
    <span
      className={cn("inline-flex h-5 items-center gap-1 border border-line2 px-1.5 font-mono text-[10px] uppercase tracking-[.08em] text-muted", className)}
      style={color ? { color, borderColor: `color-mix(in srgb, ${color} 45%, transparent)` } : undefined}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("skeleton", className)} style={style} />;
}

export function EmptyState({ icon, title, text, action, className }: { icon?: ReactNode; title: ReactNode; text?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-16 text-center", className)}>
      {icon && <div className="mb-1 text-dim">{icon}</div>}
      <div className="display text-[18px]">{title}</div>
      {text && <p className="max-w-[420px] text-[13px] text-muted">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const msg = typeof error === "string" ? error : error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <AlertTriangle size={28} className="text-danger" />
      <p className="selectable max-w-[520px] text-[13px] text-muted">{msg}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

/** Abschnitt mit Mono-Überschrift. */
export function Section({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-3">
        <h3 className="label">{title}</h3>
        <div className="h-px flex-1 bg-line" />
        {right}
      </div>
      {children}
    </section>
  );
}
