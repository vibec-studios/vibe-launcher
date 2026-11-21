import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";

const field = "w-full rounded-ctl border border-transparent bg-field px-3 text-[13.5px] text-text placeholder:text-dim transition-colors hover:border-line2 focus:border-brand/60 focus:outline-none disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(field, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(field, "py-2 leading-relaxed", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(field, "h-9 appearance-none pr-8")} {...rest}>
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-dim" />
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-pill transition-colors disabled:opacity-45", checked ? "bg-brand" : "bg-white/[.14]")}
    >
      <span className={cn("absolute size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-[3px]")} />
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-meta text-dim">{hint}</span>}
    </label>
  );
}

export function Row({ title, desc, children, warn }: { title: ReactNode; desc?: ReactNode; children: ReactNode; warn?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-text">{title}</div>
        {desc && <div className="mt-0.5 text-meta text-muted">{desc}</div>}
        {warn && <div className="mt-1 text-meta text-warn">{warn}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:min-w-[220px] sm:justify-end">{children}</div>
    </div>
  );
}
