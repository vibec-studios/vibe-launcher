import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { useT } from "@/i18n";
import { cn } from "./cn";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Breite: sm 420, md 560, lg 760, xl 980, full = großer Assistent (bis 1240 × fast Fensterhöhe) */
  size?: "sm" | "md" | "lg" | "xl" | "full";
  /** Schließen per Esc/Klick außerhalb verhindern (z. B. während eines Vorgangs) */
  locked?: boolean;
  protect?: boolean;
  className?: string;
}

const Protected = createContext(false);

export function ThemeProtect({ children }: { children: ReactNode }) {
  return <Protected.Provider value>{children}</Protected.Provider>;
}

export function useThemeProtected(): boolean {
  return useContext(Protected);
}

export function themeScope(protect: boolean) {
  return protect ? { "data-vt-protected": "" } : { "data-vt-scope": "", "data-part": "dialog" };
}

const widths = { sm: "w-[420px]", md: "w-[560px]", lg: "w-[760px]", xl: "w-[980px]", full: "w-[1240px] h-[calc(100%-64px)] max-h-[calc(100%-64px)]!" };

/** Modaler Dialog: angehobene Fläche mit Schatten statt Rahmen. Inhalt scrollt innerhalb, nie das Fenster. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md", locked, protect, className }: DialogProps) {
  const t = useT();
  const shielded = useContext(Protected) || !!protect;
  return (
    <D.Root open={open} onOpenChange={(o) => (!locked || o) && onOpenChange(o)}>
      <D.Portal>
        <D.Overlay className="vl-overlay fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-fade-in" />
        <D.Content
          {...themeScope(shielded)}
          onEscapeKeyDown={(e) => locked && e.preventDefault()}
          onPointerDownOutside={(e) => locked && e.preventDefault()}
          onInteractOutside={(e) => locked && e.preventDefault()}
          aria-describedby={description ? undefined : undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100%-80px)] max-w-[calc(100%-48px)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "vl-dialog rounded-panel bg-overlay shadow-e3 data-[state=open]:animate-pop-in",
            widths[size],
            className,
          )}
        >
          <Protected.Provider value={shielded}>
          <div className="vl-dialog-head flex items-start gap-4 px-6 pb-3 pt-5">
            <div className="min-w-0 flex-1">
              <D.Title className="vl-dialog-title text-title text-text">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1.5 text-[13px] text-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{typeof title === "string" ? title : ""}</D.Description>
              )}
            </div>
            {!locked && (
              <D.Close aria-label={t("common.close")} className="-mr-2 -mt-1 grid h-8 w-8 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.07] hover:text-text">
                <X size={18} />
              </D.Close>
            )}
          </div>
          {children !== undefined && <div className="vl-dialog-body scroll min-h-0 flex-1 px-6 py-3">{children}</div>}
          {footer && <div className="vl-dialog-foot flex items-center justify-end gap-2 px-6 pb-5 pt-3">{footer}</div>}
          </Protected.Provider>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
