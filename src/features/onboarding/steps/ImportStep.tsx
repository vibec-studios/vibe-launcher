import { HardDriveDownload, Shirt } from "lucide-react";
import { useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { openImport } from "@/features/import/importStore";
import { SkinImportDialog } from "@/features/skins/SkinImport";
import { useT } from "@/i18n";
import { StepHead } from "../components/StepParts";
import type { ImportFinds } from "../hooks/useImportFinds";

export function ImportStep({ finds }: { finds: ImportFinds }) {
  const t = useT();
  const [skins, setSkins] = useState(false);
  const total = finds.found.reduce((n, l) => n + l.instances.length, 0);
  return (
    <>
      <StepHead eyebrow={t("onb.import.eyebrow")} title={t("onb.import.title")} lead={t("onb.import.lead")} />
      {finds.pending ? (
        <div className="flex items-center gap-3 text-[13.5px] text-muted">
          <Spinner size={14} className="text-brand" />
          {t("onb.import.searching")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {finds.found.length > 0 && (
            <div className="flex flex-col gap-4 rounded-panel bg-surface p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-bg text-brand">
                  <HardDriveDownload size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-text">{t(total === 1 ? "onb.import.games_one" : "onb.import.games", { n: total })}</div>
                  <div className="truncate text-[12.5px] text-muted">{finds.found.map((l) => l.name).join(" · ")}</div>
                </div>
                {/* Sekundär wie „Skins übernehmen“: Hauptweg des Schritts bleibt „Weiter“ unten rechts */}
                <Button variant="ghost" onClick={() => openImport(null, "launcher")}>
                  {t("onb.import.games_cta")}
                </Button>
              </div>
            </div>
          )}
          {finds.newSkins > 0 && (
            <div className="flex items-center gap-3 rounded-panel bg-surface p-5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-bg text-brand">
                <Shirt size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-text">{t(finds.newSkins === 1 ? "onb.import.skins_one" : "onb.import.skins", { n: finds.newSkins })}</div>
                <div className="text-[12.5px] text-muted">{t("onb.import.skins_text")}</div>
              </div>
              <Button variant="ghost" onClick={() => setSkins(true)}>
                {t("onb.import.skins_cta")}
              </Button>
            </div>
          )}
          <p className="mt-2 text-[12.5px] text-dim">{t("onb.import.safe")}</p>
        </div>
      )}
      <SkinImportDialog open={skins} onOpenChange={setSkins} />
    </>
  );
}
