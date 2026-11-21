import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "ghost" | "outline" | "subtle" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-brand text-[var(--ui-on-accent)] hover:brightness-110",
  ghost: "border-transparent bg-surface2 text-text hover:bg-surface3",
  outline: "bg-transparent text-text border-line2 hover:bg-white/[.04]",
  subtle: "border-transparent bg-transparent text-muted hover:text-text hover:bg-white/[.06]",
  danger: "border-transparent bg-danger/12 text-danger hover:bg-danger hover:text-black",
};

const sizes = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-[13.5px] gap-2",
  lg: "h-12 px-6 text-[15px] gap-2.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "ghost", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-ctl border font-semibold whitespace-nowrap transition-[background-color,color,filter] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-45",
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
  tone?: "default" | "danger";
}

export function IconButton({ label, size = "md", tone = "default", className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-ctl text-muted transition-colors hover:bg-white/[.07] hover:text-text disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "size-7" : "size-9",
        tone === "danger" && "hover:bg-danger/15 hover:text-danger",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
