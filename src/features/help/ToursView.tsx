import { useT } from "@/i18n";
import { TOURS, guideById } from "./content/catalog";
import { useHelpContent } from "./content";
import { GuideIcon } from "./icons";
import { openHelp } from "./store";
import { TourButton, TourStatus } from "./TourControls";
import { resetTourProgress, useTours } from "./tour/store";

export function ToursView() {
  const t = useT();
  const content = useHelpContent();
  const any = useTours((s) => Object.keys(s.progress).length > 0);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-section text-text">{t("help.tours")}</h3>
        <p className="mt-0.5 text-[12.5px] text-muted">{t("help.tours.desc")}</p>
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-card bg-surface" data-testid="tour-list">
        {TOURS.map((tour) => {
          const guide = tour.guide ? guideById(tour.guide) : undefined;
          const text = content.tours[tour.id];
          return (
            <li key={tour.id} className="flex items-center gap-3 px-4 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-ctl bg-white/[.05] text-muted">
                <GuideIcon name={guide?.icon ?? "sparkles"} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13.5px] font-semibold text-text">{text.title}</span>
                  <TourStatus id={tour.id} />
                </div>
                <div className="flex items-center gap-2 text-[12px] text-dim">
                  <span>{t("help.tour.steps", { n: tour.steps.length })}</span>
                  {guide && (
                    <>
                      <span aria-hidden>·</span>
                      <button className="underline decoration-line2 underline-offset-2 hover:text-text" onClick={() => openHelp(guide.id)}>
                        {t("help.read_guide")}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <TourButton id={tour.id} />
            </li>
          );
        })}
      </ul>
      {any && (
        <button className="self-start px-1 text-[12px] text-dim underline decoration-line2 underline-offset-2 hover:text-text" onClick={resetTourProgress}>
          {t("help.reset")}
        </button>
      )}
    </div>
  );
}
