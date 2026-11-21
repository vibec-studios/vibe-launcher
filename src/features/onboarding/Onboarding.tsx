// Onboarding beim ersten Start (Einstellung `onboarding_done` fehlt/false) – wenige, ruhige Schritte im ganzen Fenster:
//   1. Willkommen + Sprache   2. Modus (Simple/Expert mit Vorschau)   3. Microsoft-Anmeldung (überspringbar)
//   4. Vibe an/aus   5. Import aus anderen Launchern (nur, wenn etwas gefunden wurde)   6. Erstes Spiel
// Bestehende Nutzer sehen es nie (Backend setzt `onboarding_done`), es lässt sich aber in den Einstellungen erneut
// starten. Alle Entscheidungen werden sofort gespeichert; „Fertig“ setzt nur noch das Flag.
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSettings } from "@/lib/queries";
import { patchSettings, setMode, useMode } from "@/lib/mode";
import { useT } from "@/i18n";
import { Button, cn, toast } from "@/components/ui";
import { Logo3D } from "@/components/Logo3D";
import { WindowControls } from "@/app/WindowControls";
import { useOnboarding } from "./store";
import { useImportFinds } from "./hooks/useImportFinds";
import { OnboardingFrame } from "./components/OnboardingFrame";
import { AccountStep } from "./steps/AccountStep";
import { GameStep } from "./steps/GameStep";
import { ImportStep } from "./steps/ImportStep";
import { ModeStep } from "./steps/ModeStep";
import { VibeStep } from "./steps/VibeStep";
import { WelcomeStep } from "./steps/WelcomeStep";

type StepId = "welcome" | "mode" | "account" | "vibe" | "import" | "game";

export function Onboarding() {
  const t = useT();
  const nav = useNavigate();
  const mode = useMode();
  const finds = useImportFinds(true);
  // Neue Nutzer: Simple ist vorausgewählt (empfohlen); beim erneuten Starten bleibt der aktuelle Modus
  const manual = useOnboarding((s) => s.open);
  const fresh = useSettings().data?.onboarding_done === false;
  useEffect(() => {
    if (!manual && fresh && mode === "expert") void setMode("simple").catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const steps = useMemo<StepId[]>(
    () => ["welcome", "mode", "account", "vibe", ...(finds.pending || finds.any ? (["import"] as const) : []), "game"],
    [finds.pending, finds.any],
  );
  const [step, setStep] = useState<StepId>("welcome");
  const idx = Math.max(0, steps.indexOf(step));
  const next = () => setStep(steps[Math.min(idx + 1, steps.length - 1)]);
  const back = () => setStep(steps[Math.max(idx - 1, 0)]);

  // Import-Schritt verschwindet, wenn nichts gefunden wurde, während er offen ist -> weiter
  useEffect(() => {
    if (step === "import" && !finds.pending && !finds.any) setStep("game");
  }, [step, finds.pending, finds.any]);

  const finish = async (after?: () => void) => {
    try {
      await patchSettings({ onboarding_done: true, simple_hint_seen: true });
    } catch (e) {
      toast.error(e);
    }
    useOnboarding.setState({ open: false });
    nav({ to: "/" });
    after?.();
  };

  return (
    <OnboardingFrame label={t("onb.aria")}>
      {/* Eigene schmale Titelleiste: verschiebbar, Fensterknöpfe bleiben erreichbar */}
      <header data-tauri-drag-region className="flex h-[var(--titlebar-h)] shrink-0 items-center pl-4">
        <div data-tauri-drag-region className="flex items-center gap-2 text-[13px] font-semibold text-muted">
          <Logo3D size={22} speed={0} float={false} interactive={false} hoverSpin={false} />
          Vibe Launcher
        </div>
        <div data-tauri-drag-region className="flex h-full flex-1 items-center justify-center gap-1.5">
          {steps.map((s, i) => (
            <span
              key={s}
              className={cn("h-1 transition-[width,background-color] duration-200", i === idx ? "w-8 bg-brand" : i < idx ? "w-4 bg-white/40" : "w-4 bg-white/12")}
              aria-hidden
            />
          ))}
        </div>
        <WindowControls />
      </header>

      <main className="flex min-h-0 flex-1 flex-col rounded-tl-panel bg-panel">
        <div className="scroll min-h-0 flex-1">
          <div key={step} className="vl-step mx-auto flex min-h-full w-full max-w-[860px] flex-col justify-center px-10 py-10">
            {step === "welcome" ? (
              <WelcomeStep />
            ) : step === "mode" ? (
              <ModeStep />
            ) : step === "account" ? (
              <AccountStep />
            ) : step === "vibe" ? (
              <VibeStep />
            ) : step === "import" ? (
              <ImportStep finds={finds} />
            ) : (
              <GameStep mode={mode} onFinish={finish} />
            )}
          </div>
        </div>
        <footer className="flex shrink-0 items-center gap-3 px-10 pb-7 pt-3">
          {idx > 0 ? (
            <Button variant="subtle" icon={<ArrowLeft size={15} />} onClick={back}>
              {t("common.back")}
            </Button>
          ) : (
            <span className="text-[12.5px] text-dim">{t("onb.step", { n: idx + 1, total: steps.length })}</span>
          )}
          <div className="flex-1" />
          {step === "account" || step === "import" ? (
            <Button variant="subtle" onClick={next}>
              {t("onb.skip")}
            </Button>
          ) : null}
          {step === "game" ? (
            <Button variant="primary" size="lg" onClick={() => void finish()} className="min-w-[160px]">
              {t("onb.finish")}
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={next} className="min-w-[160px]">
              {step === "welcome" ? t("onb.start") : t("onb.next")}
              <ArrowRight size={16} />
            </Button>
          )}
        </footer>
      </main>
    </OnboardingFrame>
  );
}
