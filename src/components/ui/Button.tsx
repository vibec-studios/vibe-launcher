import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

export type ButtonVariant = "primary" | "accent" | "ghost" | "outline" | "subtle" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

// Hierarchie: primary/accent = Hauptaktion (gefüllt, Farbe) · ghost = Sekundär (gefüllte Fläche, ohne Rahmen)
// · outline = selten, mit Haarlinie · subtle = nur Text · danger = rot getönt.
const variants: Record<ButtonVariant, string> = {
  // Globale Akzentfarbe (Einstellung „Akzentfarbe“)
  primary: "border-transparent bg-brand text-[var(--ui-on-accent)] hover:brightness-110",
  // Akzent der aktuellen Instanz
  accent: "border-transparent bg-accent text-[var(--on-accent)] hover:brightness-110",
  ghost: "border-transparent bg-surface2 text-text hover:bg-surface3",
  outline: "bg-transparent text-text border-line2 hover:border-white/25 hover:bg-white/[.04]",
  subtle: "border-transparent bg-transparent text-muted hover:text-text hover:bg-white/[.06]",
  danger: "border-transparent bg-danger/12 text-danger hover:bg-danger hover:text-black",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-[13.5px] gap-2",
  lg: "h-11 px-6 text-[15px] gap-2.5",
};

/** Knopf. Ecken folgen der Einstellung (rounded-ctl). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "ghost", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "vl-btn inline-flex shrink-0 items-center justify-center rounded-ctl border font-sans font-semibold whitespace-nowrap",
        `vl-btn-${variant} vl-btn-${size}`,
        "transition-[background-color,color,border-color,filter,transform] duration-150 active:translate-y-px",
        "disabled:opacity-45 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === "lg" ? 16 : 13} /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
  active?: boolean;
  /** filled = Fläche (Standard), ghost = nur Symbol, Fläche beim Hover, accent = Hauptaktion (Akzentfarbe) */
  variant?: "filled" | "ghost" | "accent";
  /** Tooltip mit `label` (oder eigenem Inhalt) zeigen */
  tip?: boolean | ReactNode;
  tipSide?: "top" | "bottom" | "left" | "right";
  /** Kleines Abzeichen oben rechts: Zahl oder Punkt (true) */
  badge?: number | boolean | null;
  badgeTone?: "accent" | "warn" | "danger" | "muted";
}

/** Quadratischer Symbol-Knopf. `label` wird als aria-label und title genutzt. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", active, variant = "filled", tip, tipSide = "bottom", badge, badgeTone = "accent", className, children, ...rest },
  ref,
) {
  const tone = { accent: "bg-accent text-[var(--on-accent)]", warn: "bg-warn text-black", danger: "bg-danger text-black", muted: "bg-surface3 text-text" }[badgeTone];
  const btn = (
    <button
      ref={ref}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "vl-ibtn inline-grid shrink-0 place-items-center rounded-ctl border border-transparent transition-colors duration-150",
        active ? "vl-ibtn-active" : `vl-ibtn-${variant}`,
        active
          ? "bg-surface3 text-text"
          : variant === "ghost"
            ? "bg-transparent text-muted hover:bg-white/[.07] hover:text-text"
            : variant === "accent"
              ? "bg-accent text-[var(--on-accent)] hover:brightness-110"
              : "bg-surface2 text-muted hover:bg-surface3 hover:text-text",
        "relative disabled:opacity-45 disabled:pointer-events-none",
        size === "sm" ? "h-8 w-8" : "h-9 w-9",
        className,
      )}
      {...rest}
    >
      {children}
      {badge !== undefined && badge !== null && badge !== false && badge !== 0 && (
        <span
          className={cn(
            "pointer-events-none absolute -right-1 -top-1 grid place-items-center rounded-pill font-semibold leading-none tabular-nums",
            badge === true ? "h-2 w-2 rounded-dot" : "h-4 min-w-4 px-1 text-[10px]",
            tone,
          )}
        >
          {badge === true ? null : badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
  if (!tip) return btn;
  return (
    <Tooltip content={tip === true ? label : tip} side={tipSide}>
      {btn}
    </Tooltip>
  );
});
