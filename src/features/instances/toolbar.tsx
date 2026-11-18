// Gemeinsame Werkzeugzeile der Instanzseite: links die Unterseiten-Umschaltung, rechts die Werkzeuge der aktiven
// Unterseite. Unterseiten rendern ihre Werkzeuge mit <PageTools> per Portal in diese Zeile (eine Zeile statt zwei).
// Ohne Zeile (z. B. auf der Serverseite) erscheinen die Werkzeuge als eigene, kompakte Zeile.
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const ToolbarSlot = createContext<HTMLElement | null | undefined>(undefined);

export function PageTools({ children }: { children: ReactNode }) {
  const el = useContext(ToolbarSlot);
  if (el === undefined) return <div className="flex h-14 shrink-0 items-center gap-2 px-6 pt-2">{children}</div>;
  return el ? createPortal(children, el) : null;
}
