import { AlertTriangle, ExternalLink, ShieldCheck, Undo2 } from "lucide-react";
import { FixBackupPicker } from "@/features/backups/FixBackupPicker";
import { useT } from "@/i18n";
import type { FixBackup, FixPlan, FixStep, LoaderKind } from "@/lib/types";
import { EngineNote } from "@/features/vibefix/EngineNote";
import { CauseCard } from "./CauseCard";
import { StepRow } from "./StepRow";
import { unfixableText } from "./texts";

export function PlanView({
  plan,
  sel,
  alt,
  setSel,
  setAlt,
  instLoader,
  backup,
  setBackup,
  instanceId,
  crashReport,
}: {
  plan: FixPlan;
  instanceId: string;
  crashReport?: string | null;
  instLoader?: LoaderKind;
  backup: FixBackup;
  setBackup: (b: FixBackup) => void;
  sel: Record<string, boolean>;
  alt: Record<string, boolean>;
  setSel: (id: string, v: boolean) => void;
  setAlt: (id: string, v: boolean) => void;
}) {
  const t = useT();
  const causes = plan.causes ?? [];
  // Schritte einer Absturzursache stehen in deren Karte oben
  const inCause = (x: { cause?: number | null }) => x.cause != null && x.cause < causes.length;
  const rest = plan.steps.filter((s) => !inCause(s));
  // Loader-Schritte als eigener Abschnitt: betreffen die ganze Instanz, nicht einzelne Mods
  const isLoader = (s: FixStep) => s.action.kind === "set_loader" || s.action.kind === "repair_loader";
  const loader = rest.filter(isLoader);
  const normal = rest.filter((s) => !s.confirm && !isLoader(s));
  const ask = rest.filter((s) => s.confirm && !isLoader(s));
  const unfixable = plan.unfixable.filter((u) => !inCause(u));
  const manual = plan.steps.some((s) => s.action.kind === "replace" && s.action.manual);
  const loaderChange = plan.steps.some((s) => s.action.kind === "set_loader");
  const row = (s: FixStep, cause = false) => (
    <StepRow key={s.id} s={s} on={!!sel[s.id]} alt={!!alt[s.id]} onToggle={(v) => setSel(s.id, v)} onAlt={(v) => setAlt(s.id, v)} instLoader={instLoader} inCause={cause} />
  );
  return (
    <div className="flex flex-col gap-4">
      <EngineNote info={plan.analysis} className="-mb-2" />
      {causes.length > 0 && (
        <section className="flex flex-col gap-2">
          <div>
            <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.causes.title")}</h3>
            <p className="text-[12px] text-dim">{t("fix.causes.text")}</p>
          </div>
          {causes.map((d, i) => (
            <CauseCard
              key={i}
              d={d}
              steps={plan.steps.filter((s) => s.cause === i)}
              unfixable={plan.unfixable.filter((u) => u.cause === i)}
              row={row}
              instanceId={instanceId}
              crashReport={crashReport}
            />
          ))}
        </section>
      )}
      {loader.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.loader.title")}</h3>
          {loader.map((s) => row(s))}
        </section>
      )}
      {normal.length > 0 && (
        <section className="flex flex-col gap-1.5">
          {loader.length > 0 && <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.mods.title")}</h3>}
          {normal.map((s) => row(s))}
        </section>
      )}
      {ask.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.ask_title")}</h3>
          <p className="-mt-1 mb-0.5 text-[12px] text-dim">{t("fix.ask_text")}</p>
          {ask.map((s) => row(s))}
        </section>
      )}
      {unfixable.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("fix.unfixable.title")}</h3>
          {unfixable.map((u, i) => (
            <div key={i} className="flex items-start gap-2.5 px-3 py-1.5 text-[12.5px] text-muted">
              <AlertTriangle size={14} className="mt-px shrink-0 text-warn" />
              <span className="selectable min-w-0">{unfixableText(u, t)}</span>
            </div>
          ))}
        </section>
      )}
      {plan.steps.length > 0 && (
        <section className="flex flex-col gap-1.5 border-t border-line pt-3">
          <h3 className="flex items-center gap-2 text-[12.5px] font-semibold text-muted">
            <ShieldCheck size={13} className={backup.mode === "none" ? "text-dim" : "text-ok"} />
            {t("fix.backup.title")}
          </h3>
          <FixBackupPicker value={backup} onChange={setBackup} />
          <p className="text-[11.5px] text-dim">{t("fix.backup.remembered")}</p>
        </section>
      )}
      <div className="flex flex-col gap-1 text-[12px] text-dim empty:hidden">
        {manual && (
          <span className="flex items-center gap-2">
            <ExternalLink size={13} className="shrink-0" />
            {t("fix.manual_note")}
          </span>
        )}
        {loaderChange && (
          <span className="flex items-center gap-2">
            <Undo2 size={13} className="shrink-0" />
            {t("fix.loader_note")}
          </span>
        )}
      </div>
    </div>
  );
}
