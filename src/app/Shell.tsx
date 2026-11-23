// App-Rahmen: Seitenleiste und Titelleiste bilden einen ruhigen, durchgehenden Rahmen (ohne Trennlinien);
// die Inhaltsfläche liegt eine Stufe heller darin (Ecke oben links folgt der Einstellung „Ecken“).
// Seitenleiste: Navigation, zuletzt gespielte Instanzen, Einstellungen.
// Titelleiste: Zurück/Vor, Brotkrumen, laufende Spiele, Aufgaben, Feedback, Freunde, Konto-Menü, Fensterknöpfe.
// Simple-Modus (src/lib/mode.tsx): feste, kurze Navigation mit Beschriftung; Onboarding/Einführung hängen hier.
import { Outlet, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { useLiveAppearance } from "@/lib/appearance";
import { ActionHost } from "@/components/instance/ActionHost";
import { PackUpdateHost } from "@/features/packupdate/PackUpdateHost";
import { VibeExtrasHost } from "@/features/vibe-extras/VibeExtrasHost";
import { NoticeBar } from "./Notices";
import { ModeHost } from "@/lib/mode";
import { SimpleTour } from "@/features/onboarding/SimpleTour";
import { SimpleModeHint } from "@/features/onboarding/SimpleModeHint";
import { ImportSettingsHint, SettingsReviewDialog } from "@/features/import/SettingsOffer";
import { ErrorBoundary } from "./ErrorBoundary";
import { DeferredShellHosts, FriendsPanelHost } from "./DeferredShellHosts";
import { LibraryPreload } from "./LibraryPreload";
import { AuthBridge } from "@/features/accounts/AuthBridge";
import { VibeBridge } from "@/features/social/VibeBridge";
import { useSettingsDialog } from "@/features/settings/store";
import { AppearanceHost } from "./AppearanceHost";
import { RailV2 } from "./v2/RailV2";
import { TopbarV2 } from "./v2/TopbarV2";
import { Rail } from "./Rail";
import { Topbar } from "./Topbar";
import { ThemeMainLayer } from "@/features/themes/ThemeSlot";

// ------------------------------------------------------------------ Rahmen

const SettingsDialog = lazy(() => import("@/features/settings/SettingsDialog").then((module) => ({ default: module.SettingsDialog })));

function SettingsHost() {
  const open = useSettingsDialog((s) => s.open);
  const [wasOpened, setWasOpened] = useState(open);
  if (open && !wasOpened) setWasOpened(true);
  return wasOpened && (
    <Suspense fallback={null}>
      <SettingsDialog />
    </Suspense>
  );
}

export function Shell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const v2 = useLiveAppearance((s) => s.a.design === "v2");
  return (
    <div data-vt-scope="" data-vt-lock="" className="flex h-full">
      <ModeHost />
      <AppearanceHost />
      <LibraryPreload />
      {v2 ? <RailV2 /> : <Rail />}
      <div className="flex min-w-0 flex-1 flex-col">
        {v2 ? <TopbarV2 /> : <Topbar />}
        <div className="flex min-h-0 flex-1">
          <main data-part="main" className="vl-main relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-panel bg-panel">
            <ThemeMainLayer />
            <ErrorBoundary>
              <NoticeBar />
            </ErrorBoundary>
            <div className="relative min-h-0 flex-1">
              <ErrorBoundary key={path}>
                {/* Seitenwechsel-Animation (globals.css, „Bewegung“) – je Route neu gemountet */}
                <div className="vl-page">
                  <Outlet />
                </div>
              </ErrorBoundary>
            </div>
          </main>
          {path !== "/social" && (
            <ErrorBoundary>
              <FriendsPanelHost />
            </ErrorBoundary>
          )}
        </div>
      </div>
      <ActionHost />
      <PackUpdateHost />
      <VibeExtrasHost />
      <DeferredShellHosts />
      <VibeBridge />
      <AuthBridge />
      <SettingsHost />
      <SimpleModeHint />
      <ErrorBoundary>
        <ImportSettingsHint />
        <SettingsReviewDialog />
      </ErrorBoundary>
      <SimpleTour />
    </div>
  );
}
