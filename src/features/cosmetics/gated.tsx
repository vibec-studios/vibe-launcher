// Cosmetics gehören zu Vibe: Ist der Vibe-Hauptschalter aus, gibt es weder Sidebar-Eintrag noch Seite.
// Direkt-Links (/cosmetics, /cosmetics/creator) und ein Abschalten, während man hier ist, leiten zur Startseite um.
import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useSettings } from "@/lib/queries";
import { CosmeticsPage } from "./CosmeticsPage";
import { CreatorPage } from "./CreatorPage";

function VibeOnly({ children }: { children: ReactNode }) {
  const s = useSettings();
  // Einstellungen noch nicht geladen: nichts zeigen statt kurz die Seite aufblitzen zu lassen
  if (!s.data) return null;
  if (!s.data.vibe?.enabled) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function CosmeticsRoute() {
  return (
    <VibeOnly>
      <CosmeticsPage />
    </VibeOnly>
  );
}

export function CreatorRoute() {
  return (
    <VibeOnly>
      <CreatorPage />
    </VibeOnly>
  );
}
