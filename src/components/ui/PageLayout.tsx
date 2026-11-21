import { createContext, forwardRef, useContext, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { cn } from "./cn";
import { Button, type ButtonProps } from "./Button";
import { Tooltip } from "./Tooltip";

export const pageInset = "px-6 pt-4";

export function Page({
  children,
  className,
  bodyClassName,
  width = "full",
  scrollRef,
}: {
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  width?: "full" | "narrow" | "wide";
  scrollRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={scrollRef} className={cn("vl-page-scroll scroll h-full", className)}>
      <div
        className={cn(
          "vl-page-body flex w-full flex-col gap-4 pb-10",
          pageInset,
          width === "narrow" && "max-w-[920px]",
          width === "wide" && "mx-auto max-w-[2200px]",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function PageFrame({ toolbar, children, className, bodyClassName }: { toolbar?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <div className={cn("vl-page-frame flex h-full min-h-0 flex-col", className)}>
      {toolbar && <div className={cn("shrink-0 pb-4", pageInset)}>{toolbar}</div>}
      <div className={cn("flex min-h-0 flex-1 flex-col px-6 pb-6", !toolbar && "pt-4", bodyClassName)}>{children}</div>
    </div>
  );
}

const Compact = createContext(false);

export function useToolbarCompact() {
  return useContext(Compact);
}

function useNarrow(ref: React.RefObject<HTMLElement | null>, below: number) {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !below) return;
    const check = () => setNarrow(el.clientWidth < below);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, below]);
  return narrow;
}

export function PageToolbar({
  children,
  actions,
  className,
  compactBelow = 1100,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  compactBelow?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const compact = useNarrow(ref, compactBelow);
  return (
    <Compact.Provider value={compact}>
      <div ref={ref} data-compact={compact || undefined} className={cn("vl-toolbar flex min-h-9 flex-wrap items-start gap-x-3 gap-y-2", className)}>
        <div className="vl-toolbar-main flex min-h-9 min-w-[min(100%,240px)] flex-1 basis-0 flex-wrap items-center gap-2">{children}</div>
        {actions && <div className="vl-toolbar-actions ml-auto flex min-h-9 shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
      </div>
    </Compact.Provider>
  );
}

export const ToolbarButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string; collapse?: boolean }>(function ToolbarButton(
  { label, collapse = true, children, className, icon, ...rest },
  ref,
) {
  const compact = useContext(Compact) && collapse && !!icon;
  const btn = (
    <Button ref={ref} icon={icon} aria-label={compact ? label : undefined} className={cn(compact && "w-9! px-0!", className)} {...rest}>
      {compact ? null : (children ?? label)}
    </Button>
  );
  return compact ? (
    <Tooltip content={label} side="bottom">
      {btn}
    </Tooltip>
  ) : (
    btn
  );
});

export function ToolbarMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("shrink-0 whitespace-nowrap text-meta tabular-nums text-dim", className)}>{children}</span>;
}
