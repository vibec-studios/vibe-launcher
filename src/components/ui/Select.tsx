import * as S from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface SelectOption<V extends string = string> {
  value: V;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

export function Select<V extends string = string>({
  value,
  onChange,
  options,
  placeholder,
  className,
  disabled,
  size = "md",
  variant = "filled",
}: {
  value: V | null | undefined;
  onChange: (v: V) => void;
  options: SelectOption<V>[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  /** filled = Feld (Standard), ghost = nur Text + Pfeil (für Werkzeugleisten) */
  variant?: "filled" | "ghost";
}) {
  return (
    <S.Root value={value ?? ""} onValueChange={(v) => v && onChange(v as V)} disabled={disabled}>
      <S.Trigger
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 rounded-ctl border border-transparent px-3 text-left text-text outline-none transition-colors duration-150",
          variant === "ghost" ? "bg-transparent hover:bg-white/[.06] data-[state=open]:bg-white/[.06]" : "bg-field hover:bg-white/[.07]",
          "focus-visible:border-accent/70 data-[placeholder]:text-dim disabled:opacity-50",
          size === "sm" ? "h-8 text-[13px]" : "h-9 text-[13.5px]",
          className,
        )}
      >
        <span className="truncate">
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon>
          <ChevronDown size={15} className="text-dim" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-[65] max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-card bg-overlay shadow-e2 data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex h-8 cursor-pointer select-none items-center gap-2 rounded-ctl pl-7 pr-3 text-[13px] outline-none data-[highlighted]:bg-white/[.07] data-[disabled]:opacity-40"
              >
                <S.ItemIndicator className="absolute left-2 text-accent">
                  <Check size={13} />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
                {o.hint && <span className="ml-auto pl-3 text-[11px] text-dim">{o.hint}</span>}
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
