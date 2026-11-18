// Wendet die Darstellung (gespeichert oder Vorschau aus dem Einstellungs-Tab) an und zeichnet den Hintergrund.
import { useEffect } from "react";
import { useSettings } from "@/lib/queries";
import { applyAppearance, normalizeAppearance, useAppearanceDraft } from "@/lib/appearance";
import { Backdrop } from "./Backdrop";

export function AppearanceHost() {
  const saved = useSettings().data?.appearance;
  const draft = useAppearanceDraft((s) => s.draft);
  const a = normalizeAppearance(draft ?? saved);
  const key = JSON.stringify(a);
  useEffect(() => {
    // Erst anwenden, wenn die Einstellungen geladen sind – vorher gilt der Cache aus main.tsx
    if (draft || saved) applyAppearance(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <Backdrop appearance={a} />;
}
