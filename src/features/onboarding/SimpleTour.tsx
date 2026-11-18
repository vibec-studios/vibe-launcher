// Kurze Einführung im Simple-Modus: 4 Hinweis-Bubbles auf die wichtigsten Knöpfe (Spielen bzw. Neues Spiel,
// Meine Spiele, Entdecken, Konto). Läuft einmal nach dem Onboarding bzw. beim ersten Wechsel in Simple,
// jederzeit überspringbar; erneut startbar in den Einstellungen. Ziele tragen `data-tour="…"`.
// Flach: Abdunklung per Schatten um das Ziel (kein Blur), eckige Bubble mit Pfeil.
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { Button, cn } from "@/components/ui";
import { useInstances, useSettings } from "@/lib/queries";
import { patchSettings } from "@/lib/mode";
import { useT } from "@/i18n";
import { useOnboarding } from "./store";

interface TourStep {
  key: string;
  /** Erstes vorhandenes Ziel gewinnt */
  targets: string[];
}

const STEPS: TourStep[] = [
  { key: "play", targets: ['[data-tour="play"]', '[data-tour="new-game"]'] },
  { key: "library", targets: ['[data-tour="instances"]'] },
  { key: "discover", targets: ['[data-tour="discover"]'] },
  { key: "account", targets: ['[data-tour="account"]'] },
];

const W = 300;
const PAD = 6;

function findTarget(step: TourStep): { el: Element; which: number } | null {
  for (let i = 0; i < step.targets.length; i++) {
    const el = document.querySelector(step.targets[i]);
    if (el && el.getBoundingClientRect().width > 0) return { el, which: i };
  }
  return null;
}

export function SimpleTour() {
  const s = useSettings().data;
  const manual = useOnboarding((x) => x.tour);
  const onboarding = useOnboarding((x) => x.open);
  const path = useRouterState({ select: (r) => r.location.pathname });
  // Erst starten, wenn feststeht, ob es schon Spiele gibt (sonst zeigt Schritt 1 auf das falsche Ziel)
  const games = useInstances().data;
  const auto = !!s && s.onboarding_done && s.ui_mode === "simple" && !s.simple_tour_done;
  const active = (manual || auto) && !onboarding && !!s?.onboarding_done && s.ui_mode === "simple";
  if (!active || !games) return null;
  return <Tour onHome={path === "/"} hasGames={games.length > 0} />;
}

function Tour({ onHome, hasGames }: { onHome: boolean; hasGames: boolean }) {
  const t = useT();
  const nav = useNavigate();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [variant, setVariant] = useState(0);
  const step = i === 0 ? { ...STEPS[0], targets: hasGames ? STEPS[0].targets : STEPS[0].targets.slice(1) } : STEPS[i];

  // Die Einführung beginnt auf der Startseite
  useEffect(() => {
    if (!onHome) nav({ to: "/" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ziel suchen (Seite lädt evtl. noch), Position bei Größenänderung nachführen; fehlt es, Schritt überspringen
  useLayoutEffect(() => {
    let tries = 0;
    let timer = 0;
    const locate = () => {
      const found = findTarget(step);
      if (found) {
        setRect(found.el.getBoundingClientRect());
        setVariant(hasGames ? found.which : 1);
        return;
      }
      if (++tries > 20) {
        setRect(null);
        if (i < STEPS.length - 1) setI(i + 1);
        else void done();
        return;
      }
      timer = window.setTimeout(locate, 150);
    };
    setRect(null);
    locate();
    const onResize = () => {
      const f = findTarget(step);
      if (f) setRect(f.el.getBoundingClientRect());
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, onHome]);

  const done = async () => {
    useOnboarding.setState({ tour: false });
    await patchSettings({ simple_tour_done: true }).catch(() => {});
  };
  const last = i === STEPS.length - 1;
  const key = step.key === "play" && variant === 1 ? "new" : step.key;

  if (!rect) return null;
  // Bubble rechts neben Zielen in der Seitenleiste, sonst darunter (bzw. darüber, wenn unten kein Platz ist)
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const side: "right" | "bottom" | "top" = rect.right < 260 ? "right" : rect.bottom + 190 < vh ? "bottom" : "top";
  const pos =
    side === "right"
      ? { left: rect.right + 14, top: Math.min(Math.max(12, rect.top + rect.height / 2 - 60), vh - 200) }
      : {
          left: Math.min(Math.max(12, rect.left + rect.width / 2 - W / 2), vw - W - 12),
          top: side === "bottom" ? rect.bottom + 14 : undefined,
          bottom: side === "top" ? vh - rect.top + 14 : undefined,
        };
  const arrowLeft = side === "right" ? undefined : Math.min(Math.max(14, rect.left + rect.width / 2 - (pos.left as number) - 6), W - 26);

  return (
    <div className="fixed inset-0 z-[45]" aria-live="polite">
      {/* Abdunklung mit Aussparung um das Ziel; Klicks außerhalb tun nichts */}
      <div
        className="pointer-events-none absolute outline outline-2 outline-offset-0 outline-[var(--ui-accent)] transition-[left,top,width,height] duration-200"
        style={{
          left: rect.left - PAD,
          top: rect.top - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
          boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.62)",
          borderRadius: "var(--r-card)",
        }}
      />
      <div
        role="dialog"
        aria-label={t(`tour.${key}.title`)}
        className="vl-bubble absolute rounded-card bg-overlay p-4 shadow-e3"
        style={{ width: W, ...pos }}
        key={i}
      >
        <span
          aria-hidden
          className={cn("absolute h-3 w-3 rotate-45 bg-overlay", side === "right" ? "-left-1.5 top-[54px]" : side === "bottom" ? "-top-1.5" : "-bottom-1.5")}
          style={arrowLeft !== undefined ? { left: arrowLeft } : undefined}
        />
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-semibold tabular-nums text-brand">{t("tour.count", { n: i + 1, total: STEPS.length })}</div>
            <div className="mt-1 text-[15px] font-semibold text-text">{t(`tour.${key}.title`)}</div>
          </div>
          <button aria-label={t("tour.skip")} onClick={() => void done()} className="-mr-1.5 -mt-1 grid h-7 w-7 place-items-center rounded-ctl text-dim hover:bg-white/[.07] hover:text-text">
            <X size={15} />
          </button>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t(`tour.${key}.text`)}</p>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={() => void done()} className="text-[12.5px] font-medium text-dim transition-colors hover:text-text">
            {t("tour.skip")}
          </button>
          <div className="flex-1" />
          {i > 0 && (
            <Button size="sm" variant="subtle" onClick={() => setI(i - 1)}>
              {t("common.back")}
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => (last ? void done() : setI(i + 1))}>
            {last ? t("tour.done") : t("onb.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
