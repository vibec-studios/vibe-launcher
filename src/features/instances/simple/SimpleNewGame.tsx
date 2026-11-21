// „Neues Spiel“ im Simple-Modus: geführter Assistent nach Ziel statt nach Technik.
//   1. Ziel wählen (Normal spielen, Mehr FPS, Mit Mods/Modpack, Mit Freunden)
//   2. Mit Mods: fertiges Modpack wählen oder eigene Auswahl – sonst direkt weiter
//   3. Name + Farbe, kurze Zusammenfassung in Alltagssprache, „Spiel erstellen“
// Version und Mod-Unterbau wählt der Launcher (`usePlan`). „Erweitert“ wechselt in den vollen Dialog.
import * as D from "@radix-ui/react-dialog";
import { ArrowLeft, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { Button, cn } from "@/components/ui";
import { restoreNewInstanceFocus } from "@/components/instance/actions";
import { useT } from "@/i18n";
import { GoalTiles, type NewGameGoal } from "./goals";
import { DetailsStep } from "./wizard/DetailsStep";
import { PacksStep } from "./wizard/PacksStep";
import { AdvancedLink, Dots, Footer, type Step } from "./wizard/parts";

export function SimpleNewGameDialog({ open, goal: initialGoal, onOpenChange }: { open: boolean; goal: NewGameGoal | null; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const [goal, setGoal] = useState<NewGameGoal | null>(initialGoal);
  const [step, setStep] = useState<Step>("goal");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setGoal(initialGoal);
    setStep(initialGoal ? (initialGoal === "mods" ? "packs" : "details") : "goal");
    setBusy(false);
  }, [open, initialGoal]);
  const close = () => onOpenChange(false);
  const pick = (g: NewGameGoal) => {
    setGoal(g);
    setStep(g === "mods" ? "packs" : "details");
  };
  const back = () => setStep(step === "details" && goal === "mods" ? "packs" : "goal");

  return (
    <D.Root open={open} onOpenChange={(o) => (!busy || o) && onOpenChange(o)}>
      <D.Portal>
        <D.Overlay className="vl-overlay fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-fade-in" />
        <D.Content
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
          onInteractOutside={(e) => busy && e.preventDefault()}
          onCloseAutoFocus={restoreNewInstanceFocus}
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "h-[min(660px,calc(100%-48px))] w-[900px] max-w-[calc(100%-48px)]",
            "vl-dialog rounded-panel bg-overlay shadow-e3 data-[state=open]:animate-pop-in",
          )}
          style={{ "--accent": "var(--ui-accent)", "--on-accent": "var(--ui-on-accent)" } as CSSProperties}
        >
          <header className="flex min-h-[72px] shrink-0 items-center gap-3 px-6 py-3">
            {step !== "goal" && !busy && (
              <button
                aria-label={t("common.back")}
                onClick={back}
                className="-ml-2 grid h-8 w-8 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.07] hover:text-text"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <D.Title className="truncate text-title text-text">{step === "goal" ? t("wiz.title") : t(`goal.${goal}`)}</D.Title>
              <p className="break-words text-[14px] text-muted">{step === "goal" ? t("wiz.lead") : step === "packs" ? t("wiz.packs.lead") : t("wiz.details.lead")}</p>
            </div>
            <Dots step={step} withPacks={goal === "mods"} />
            {!busy && (
              <D.Close aria-label={t("common.close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.07] hover:text-text">
                <X size={18} />
              </D.Close>
            )}
          </header>

          <div key={step} className="vl-step flex min-h-0 flex-1 flex-col">
            {step === "goal" ? (
              <>
                <div className="scroll min-h-0 flex-1 px-6 pb-4 pt-1">
                  <GoalTiles onPick={pick} variant="list" />
                </div>
                <Footer>
                  <AdvancedLink />
                  <div className="flex-1" />
                  <Button variant="subtle" onClick={close}>
                    {t("common.cancel")}
                  </Button>
                </Footer>
              </>
            ) : step === "packs" ? (
              <PacksStep onOwn={() => setStep("details")} onDone={close} />
            ) : (
              goal && <DetailsStep goal={goal} onDone={close} onBusy={setBusy} />
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
