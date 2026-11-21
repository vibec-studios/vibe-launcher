import { Gauge, LayoutGrid, ListTree, Play, ShieldCheck, Sparkles, Terminal } from "lucide-react";
import { cn, toast } from "@/components/ui";
import { setMode, useMode, type UiMode } from "@/lib/mode";
import { useT } from "@/i18n";
import { Bullet, Choice, StepHead } from "../components/StepParts";

/** Mini-Vorschau der Oberfläche (flach, eckig): Simple = großer Spielen-Knopf + Kacheln, Expert = Liste + Werkzeuge. */
function ModePreview({ mode }: { mode: UiMode }) {
  const bar = (w: string, c = "bg-white/10") => <span className={cn("block h-1.5", c)} style={{ width: w }} />;
  return (
    <div className="flex h-[132px] overflow-hidden rounded-card bg-bg" aria-hidden>
      {/* Seitenleiste */}
      <div className={cn("flex shrink-0 flex-col gap-1.5 bg-white/[.04] p-2", mode === "simple" ? "w-[74px]" : "w-[22px] items-center")}>
        {Array.from({ length: mode === "simple" ? 4 : 8 }, (_, i) =>
          mode === "simple" ? (
            <span key={i} className="flex items-center gap-1">
              <span className={cn("h-2 w-2 shrink-0", i === 0 ? "bg-brand" : "bg-white/20")} />
              {bar(`${30 + ((i * 13) % 22)}px`, i === 0 ? "bg-white/40" : "bg-white/15")}
            </span>
          ) : (
            <span key={i} className={cn("h-2 w-2", i === 0 ? "bg-brand" : "bg-white/20")} />
          ),
        )}
      </div>
      {mode === "simple" ? (
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <div className="flex items-center gap-2 bg-white/[.06] p-2">
            <span className="h-7 w-7 shrink-0 bg-white/15" />
            <span className="flex flex-1 flex-col gap-1">
              {bar("60%", "bg-white/35")}
              {bar("35%")}
            </span>
            <span className="flex h-7 w-16 items-center justify-center bg-brand">
              <Play size={11} className="text-[var(--ui-on-accent)]" fill="currentColor" />
            </span>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <span key={i} className="flex flex-col justify-end gap-1 bg-white/[.06] p-1.5">
                <span className="h-2.5 w-2.5 bg-white/25" />
                {bar("70%", "bg-white/20")}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
          <div className="mb-1 flex gap-1.5">
            {["28%", "18%", "22%", "14%"].map((w, i) => (
              <span key={i} className={cn("h-1.5", i === 0 ? "bg-white/40" : "bg-white/12")} style={{ width: w }} />
            ))}
          </div>
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 bg-white/15" />
              {bar(`${38 + ((i * 17) % 30)}%`, "bg-white/15")}
              <span className="flex-1" />
              {bar("18%", "bg-white/8")}
              <span className={cn("h-1.5 w-3", i % 3 === 1 ? "bg-white/15" : "bg-brand/70")} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ModeStep() {
  const t = useT();
  const mode = useMode();
  const pick = (m: UiMode) => setMode(m).catch((e) => toast.error(e));
  return (
    <>
      <StepHead eyebrow={t("onb.mode.eyebrow")} title={t("onb.mode.title")} lead={t("onb.mode.lead")} />
      <div className="grid grid-cols-2 gap-4" role="radiogroup" aria-label={t("onb.mode.title")}>
        <Choice selected={mode === "simple"} onClick={() => pick("simple")} title={t("onb.mode.simple.title")} badge={t("onb.mode.recommended")} icon={<Sparkles size={19} />}>
          <ModePreview mode="simple" />
          <span className="sr-only">{t("onb.mode.simple.text")}</span>
        </Choice>
        <Choice selected={mode === "expert"} onClick={() => pick("expert")} title={t("onb.mode.expert.title")} badge={t("onb.mode.expert.badge")} icon={<Terminal size={18} />}>
          <ModePreview mode="expert" />
          <span className="sr-only">{t("onb.mode.expert.text")}</span>
        </Choice>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <ul className="flex flex-col gap-2 px-1">
          <Bullet icon={<Play size={14} />}>{t("onb.mode.simple.b1")}</Bullet>
          <Bullet icon={<LayoutGrid size={14} />}>{t("onb.mode.simple.b2")}</Bullet>
          <Bullet icon={<ShieldCheck size={14} />}>{t("onb.mode.simple.b3")}</Bullet>
        </ul>
        <ul className="flex flex-col gap-2 px-1">
          <Bullet icon={<ListTree size={14} />}>{t("onb.mode.expert.b1")}</Bullet>
          <Bullet icon={<Gauge size={14} />}>{t("onb.mode.expert.b2")}</Bullet>
          <Bullet icon={<Terminal size={14} />}>{t("onb.mode.expert.b3")}</Bullet>
        </ul>
      </div>
      <p className="mt-7 text-[12.5px] text-dim">{t("onb.mode.switch_later")}</p>
    </>
  );
}
