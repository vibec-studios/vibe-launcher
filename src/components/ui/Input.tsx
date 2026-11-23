import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "./cn";

// Gefülltes Feld ohne sichtbaren Rahmen; Fokus zeigt den Akzent.
const base =
  "vl-field w-full rounded-ctl bg-field border border-transparent text-text placeholder:text-dim px-3 outline-none transition-colors duration-150 " +
  "hover:bg-white/[.07] focus:border-accent/70 focus:bg-white/[.06] disabled:opacity-50";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, leading, trailing, invalid, ...rest }, ref) {
  if (!leading && !trailing) {
    return <input ref={ref} data-part="input" spellCheck={false} className={cn(base, "h-9 text-[13.5px]", invalid && "border-danger", className)} {...rest} />;
  }
  return (
    <div className={cn("relative flex items-center", className)}>
      {leading && <span className="pointer-events-none absolute left-3 text-dim">{leading}</span>}
      <input
        data-part="input"
        ref={ref}
        spellCheck={false}
        className={cn(base, "h-9 text-[13.5px]", leading && "pl-9", trailing && "pr-9", invalid && "border-danger")}
        {...rest}
      />
      {trailing && <span className="absolute right-2 flex items-center">{trailing}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} data-part="input" spellCheck={false} className={cn(base, "min-h-24 py-2 text-[13.5px] resize-none scroll", className)} {...rest} />;
});

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (v: string) => void;
}

/** Suchfeld mit Lupe und Löschen-Knopf. */
export function SearchInput({ value, onChange, className, ...rest }: SearchInputProps) {
  const t = useT();
  return (
    <Input
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      leading={<Search size={15} />}
      trailing={
        value ? (
          <button type="button" aria-label={t("common.clear")} className="grid h-6 w-6 place-items-center rounded-xs text-dim hover:text-text" onClick={() => onChange("")}>
            <X size={14} />
          </button>
        ) : null
      }
      {...rest}
    />
  );
}

/** Beschriftetes Formularfeld. */
export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="text-[12px] text-danger">{error}</span> : hint ? <span className="text-[12px] text-dim">{hint}</span> : null}
    </label>
  );
}
