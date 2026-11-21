import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { accentPalette } from "@/lib/format";
import { Button, Input, Spinner, cn, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { randomBlockIcon } from "@/components/instance/blocks/catalog";
import { installInstance } from "@/components/instance/actions";
import { installPackAfterCreate } from "@/features/instances/settings/ClientPacks";
import { queryClient, waitForTask } from "@/lib/queries";
import { useT, t as tt } from "@/i18n";
import { SetPicker, installSetsAfterCreate, useNewInstanceSets } from "@/features/modsets/SetPicker";
import { usePlan, type GamePlan, type NewGameGoal } from "../goals";
import { AdvancedLink, Footer } from "./parts";

// ------------------------------------------------------------------ Name + Zusammenfassung

export function defaultName(goal: NewGameGoal) {
  return tt(`wiz.name.${goal}`);
}

/** Was passiert, in Alltagssprache (ohne Loader, Versionen von Mod-Unterbauten usw.). */
export function summary(goal: NewGameGoal, plan: GamePlan, t: ReturnType<typeof useT>): string[] {
  const lines = [plan.mc ? t("wiz.sum.version", { mc: plan.mc }) : t("wiz.sum.version_auto")];
  if (goal === "fps") lines.push(t("wiz.sum.fps"));
  if (plan.pack === "essential") lines.push(t("wiz.sum.essential"));
  if (goal === "friends" && !plan.pack) lines.push(t("wiz.sum.friends_plain"));
  if (goal === "mods") lines.push(t("wiz.sum.mods"));
  lines.push(t("wiz.sum.auto"));
  return lines;
}

export function DetailsStep({ goal, onDone, onBusy }: { goal: NewGameGoal; onDone: () => void; onBusy: (b: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const plan = usePlan(goal);
  const [name, setName] = useState(() => defaultName(goal));
  const [accent, setAccent] = useState(() => accentPalette[Math.floor(Math.random() * accentPalette.length)]);
  const [icon, setIcon] = useState(randomBlockIcon);
  const { setIds, setSetIds, setsLoading } = useNewInstanceSets();
  const [busy, setBusy] = useState(false);
  const ready = !plan.loading && !!plan.mc && (plan.loader === "vanilla" || !!plan.loaderVersion);
  const valid = ready && !setsLoading && name.trim().length > 0;

  const create = async () => {
    if (!valid || busy) return;
    setBusy(true);
    onBusy(true);
    try {
      const inst = await api.instanceCreate({
        name: name.trim(),
        mc_version: plan.mc!,
        loader: { kind: plan.loader, version: plan.loader === "vanilla" ? null : plan.loaderVersion },
        accent,
        icon,
        group: null,
      });
      onDone();
      installInstance(inst.id);
      void (async () => {
        if (plan.pack) await installPackAfterCreate(t, inst.id, plan.pack);
        if (plan.perf) await installPerf(inst.id);
        if (setIds.length) await installSetsAfterCreate(t, inst.id, setIds);
      })();
      if (goal === "mods") {
        nav({ to: "/discover", search: { instance: inst.id } });
        toast.success(tt("wiz.created", { name: inst.name }), tt("wiz.created_mods"));
      } else {
        nav({ to: "/instances/$id", params: { id: inst.id }, search: { tab: "content" } });
        toast.success(tt("wiz.created", { name: inst.name }), tt("wiz.created_text"));
      }
    } catch (e) {
      toast.error(e, tt("newinst.failed"));
      setBusy(false);
      onBusy(false);
    }
  };

  return (
    <>
      <div
        className="scroll grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start gap-6 px-6 pb-4 pt-2 max-[650px]:grid-cols-1"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            void create();
          }
        }}
      >
        <div className="flex min-w-0 flex-col gap-5">
          {/* Vorschau, wie das Spiel in der Liste aussieht (statt eines losen Ziel-Symbols ohne Bedeutung) */}
          <div className="flex items-center gap-4 rounded-card bg-surface p-3">
            <button
              type="button"
              title={t("iconart.shuffle")}
              aria-label={t("iconart.shuffle")}
              onClick={() => setIcon(randomBlockIcon())}
              className="shrink-0 rounded-card outline-none transition-transform duration-100 hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <InstanceIcon icon={icon} accent={accent} size={56} />
            </button>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-text">{name.trim() || t("wiz.name")}</div>
              <div className="mt-0.5 truncate text-[12.5px] text-muted">{plan.mc ? `Minecraft ${plan.mc}` : t("wiz.sum.version_auto")}</div>
            </div>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="label">{t("wiz.name")}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus className="font-semibold" invalid={!name.trim()} />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="label">{t("wiz.color")}</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("wiz.color")}>
              {accentPalette.map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={c === accent}
                  aria-label={c}
                  onClick={() => setAccent(c)}
                  className={cn("grid h-8 w-8 place-items-center rounded-ctl transition-opacity duration-100", c === accent ? "opacity-100" : "opacity-60 hover:opacity-100")}
                  style={{ background: c }}
                >
                  {c === accent && <Check size={15} strokeWidth={3} color="#000" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <span className="label">{t("wiz.sum.title")}</span>
          <div className="rounded-card bg-surface p-4">
            {plan.loading ? (
              <div className="flex items-center gap-2.5 text-[13px] text-muted">
                <Spinner size={13} className="text-brand" />
                {t("wiz.sum.loading")}
              </div>
            ) : !plan.mc ? (
              <div className="text-[13px] text-warn">{t("wiz.sum.unavailable")}</div>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {summary(goal, plan, t).map((l) => (
                  <li key={l} className="flex items-start gap-2.5 text-[13.5px] leading-snug text-text">
                    <Check size={15} strokeWidth={2.5} className="mt-0.5 shrink-0 text-ok" />
                    {l}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="label">{t("newinst.sets")}</span>
            <SetPicker mc={plan.mc} loader={plan.loader} value={setIds} onChange={setSetIds} />
          </div>
          <p className="text-[12.5px] leading-relaxed text-dim">{t("wiz.sum.note")}</p>
        </div>
      </div>
      <Footer>
        <AdvancedLink />
        <div className="flex-1" />
        <Button variant="primary" size="lg" disabled={!valid} loading={busy} onClick={() => void create()} className="min-w-[180px]">
          {t("wiz.create")}
        </Button>
      </Footer>
    </>
  );
}

/** „Mehr FPS“: empfohlene Performance-Mods installieren (gleiche Auswahl wie „Performance-Mods“ im Expert-Modus). */
export async function installPerf(instanceId: string) {
  try {
    const list = await api.perfPreview(instanceId);
    const ids = list.filter((c) => c.recommended && c.available && !c.installed).map((c) => c.project_id);
    if (!ids.length) return;
    const task = await api.perfInstall(instanceId, ids);
    await waitForTask(task);
    queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
    toast.success(tt("perf.done"));
  } catch (e) {
    toast.error(e, tt("wiz.perf_failed"));
  }
}
