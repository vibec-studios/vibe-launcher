import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "accent" | "ghost" | "outline" | "subtle" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  // Lila Markenfläche
  primary: "bg-brand text-white border-transparent hover:brightness-110",
  // Akzent der aktuellen Instanz
  accent: "bg-accent text-[var(--on-accent)] border-transparent hover:brightness-110",
  ghost: "bg-surface2 text-text border-line hover:bg-surface3 hover:border-line2",
  outline: "bg-transparent text-text border-line2 hover:border-accent",
  subtle: "bg-transparent text-muted border-transparent hover:text-white hover:bg-white/5",
  danger: "bg-transparent text-danger border-danger/40 hover:bg-danger hover:text-black hover:border-danger",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-[14px] gap-2",
  lg: "h-11 px-6 text-[15px] gap-2.5",
};

/** Knopf im Website-Stil: Mono, Großbuchstaben, eckig. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "ghost", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center justify-center border font-sans font-semibold whitespace-nowrap",
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
}

/** Quadratischer Symbol-Knopf. `label` wird als aria-label und title genutzt. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", active, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-grid shrink-0 place-items-center border text-text transition-colors duration-150",
        active ? "border-line2 bg-surface3 text-white" : "border-line bg-surface2 text-muted hover:bg-surface3 hover:text-white",
        "disabled:opacity-45 disabled:pointer-events-none",
        size === "sm" ? "h-8 w-8" : "h-9 w-9",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
