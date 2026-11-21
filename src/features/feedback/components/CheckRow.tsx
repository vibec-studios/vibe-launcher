import type { ReactNode } from "react";
import { Checkbox, cn } from "@/components/ui";

export function CheckRow({
  checked,
  onChange,
  title,
  desc,
  disabled,
  aside,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  desc?: string;
  disabled?: boolean;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-3 px-3.5 py-2.5", disabled && "opacity-60")}>
      <Checkbox checked={checked} disabled={disabled} onChange={onChange} label={title} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="text-left text-[13.5px] font-medium text-text">
          {title}
        </button>
        {desc && <div className="text-[12px] text-muted">{desc}</div>}
        {children}
      </div>
      {aside}
    </div>
  );
}
