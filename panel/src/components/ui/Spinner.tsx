import { cn } from "./cn";

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cn("animate-spin", className)} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Progress({ value, className }: { value: number | null; className?: string }) {
  return (
    <div role="progressbar" aria-valuenow={value == null ? undefined : Math.round(value * 100)} className={cn("relative h-1.5 overflow-hidden rounded-pill bg-white/[.08]", className)}>
      {value == null ? (
        <div className="absolute inset-y-0 w-2/5 rounded-pill bg-brand" style={{ animation: "indeterminate 1.2s ease-in-out infinite" }} />
      ) : (
        <div className="h-full rounded-pill bg-brand transition-[width] duration-300" style={{ width: `${Math.max(2, value * 100)}%` }} />
      )}
    </div>
  );
}
