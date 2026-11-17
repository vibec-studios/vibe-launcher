import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Breite: sm 420, md 560, lg 760, xl 980 */
  size?: "sm" | "md" | "lg" | "xl";
  /** Schließen per Esc/Klick außerhalb verhindern (z. B. während eines Vorgangs) */
  locked?: boolean;
  className?: string;
}

const widths = { sm: "w-[420px]", md: "w-[560px]", lg: "w-[760px]", xl: "w-[980px]" };

/** Modaler Dialog im Website-Look. Inhalt scrollt innerhalb, nie das Fenster. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md", locked, className }: DialogProps) {
  return (
    <D.Root open={open} onOpenChange={(o) => (!locked || o) && onOpenChange(o)}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-fade-in" />
        <D.Content
          onEscapeKeyDown={(e) => locked && e.preventDefault()}
          onPointerDownOutside={(e) => locked && e.preventDefault()}
          onInteractOutside={(e) => locked && e.preventDefault()}
          aria-describedby={description ? undefined : undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-80px)] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "border border-line2 bg-[#07070a] shadow-[0_24px_60px_rgba(0,0,0,.7)] data-[state=open]:animate-pop-in",
            "border-t-2 border-t-accent",
            widths[size],
            className,
          )}
        >
          <div className="flex items-start gap-4 border-b border-line px-6 pb-4 pt-5">
            <div className="min-w-0 flex-1">
              <D.Title className="display text-[20px]">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1.5 text-[13px] text-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{typeof title === "string" ? title : ""}</D.Description>
              )}
            </div>
            {!locked && (
              <D.Close aria-label="Schließen" className="-mr-2 grid h-8 w-8 place-items-center text-dim transition-colors hover:text-white">
                <X size={18} />
              </D.Close>
            )}
          </div>
          {children !== undefined && <div className="scroll min-h-0 flex-1 px-6 py-5">{children}</div>}
          {footer && <div className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
