// „Neues Spiel“ im Simple-Modus: geführter Assistent nach Ziel statt nach Technik.
//   1. Ziel wählen (Normal spielen, Mehr FPS, Mit Mods/Modpack, Mit Freunden, Vibey Client)
//   2. Mit Mods: fertiges Modpack wählen oder eigene Auswahl – sonst direkt weiter
//   3. Name + Farbe, kurze Zusammenfassung in Alltagssprache, „Spiel erstellen“
// Version und Mod-Unterbau wählt der Launcher (`usePlan`). „Erweitert“ wechselt in den vollen Dialog.
import * as D from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Download, Search, SlidersHorizontal, Wand2, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { accentPalette, formatCount } from "@/lib/format";
import type { ProjectHit } from "@/lib/types";
import { Button, ErrorState, Input, SearchInput, Skeleton, Spinner, cn, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { installInstance, openExpertNewInstance } from "@/components/instance/actions";
import { startModpackInstall } from "@/components/content/install";
import { PackIcon } from "@/features/home/Discover";
import { usePopularModpacks } from "@/features/home/data";
import { installPackAfterCreate } from "@/features/instances/settings/ClientPacks";
import { queryClient, waitForTask } from "@/lib/queries";
import { useT, t as tt } from "@/i18n";
import { GoalTiles, usePlan, type GamePlan, type NewGameGoal } from "./goals";

type Step = "goal" | "packs" | "details";

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
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "h-[min(640px,calc(100vh-64px))] w-[820px] max-w-[calc(100vw-48px)]",
            "vl-dialog rounded-panel bg-overlay shadow-e3 data-[state=open]:animate-pop-in",
          )}
          style={{ "--accent": "var(--ui-accent)", "--on-accent": "var(--ui-on-accent)" } as CSSProperties}
        >
          <header className="flex h-[64px] shrink-0 items-center gap-3 pl-6 pr-4">
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
              <p className="truncate text-[12.5px] text-muted">{step === "goal" ? t("wiz.lead") : step === "packs" ? t("wiz.packs.lead") : t("wiz.details.lead")}</p>
            </div>
            <Dots step={step} withPacks={goal === "mods"} />
            {!busy && (
              <D.Close aria-label={t("common.close")} className="grid h-8 w-8 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.07] hover:text-text">
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

function Dots({ step, withPacks }: { step: Step; withPacks: boolean }) {
  const steps: Step[] = withPacks ? ["goal", "packs", "details"] : ["goal", "details"];
  const idx = steps.indexOf(step);
  return (
    <div className="flex shrink-0 items-center gap-1.5 pr-2" aria-hidden>
      {steps.map((s, i) => (
        <span key={s} className={cn("h-1.5 transition-[width,background-color] duration-200", i === idx ? "w-5 bg-brand" : i < idx ? "w-1.5 bg-white/40" : "w-1.5 bg-white/15")} />
      ))}
    </div>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <footer className="flex shrink-0 items-center gap-3 border-t border-line px-6 py-4">{children}</footer>;
}

/** „Erweitert“: in den vollen Dialog mit allen Versionen und Mod-Unterbauten. */
function AdvancedLink() {
  const t = useT();
  return (
    <button onClick={openExpertNewInstance} className="flex items-center gap-1.5 text-[12.5px] font-medium text-dim transition-colors hover:text-text">
      <SlidersHorizontal size={13} />
      {t("wiz.advanced")}
    </button>
  );
}

// ------------------------------------------------------------------ Modpacks

function PacksStep({ onOwn, onDone }: { onOwn: () => void; onDone: () => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);
  const popular = usePopularModpacks(12);
  const search = useQuery({
    queryKey: ["simple-wiz", "packs", debounced],
    queryFn: () =>
      api.contentSearch({ source: "modrinth", query: debounced, project_type: "modpack", game_version: null, loader: null, categories: [], sort: "relevance", offset: 0, limit: 12 }),
    enabled: debounced.length > 0,
    staleTime: 60_000,
  });
  const q = debounced ? search : popular;
  const hits = debounced ? search.data?.hits : popular.data;
  const install = (h: ProjectHit) => {
    startModpackInstall(h, null, () => true)
      .then(() => toast.info(tt("wiz.pack.started", { name: h.title }), tt("wiz.pack.started_text")))
      .catch((e) => toast.error(e, tt("install.failed", { name: h.title })));
    onDone();
  };
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-4 pt-1">
        <button
          onClick={onOwn}
          className="flex items-center gap-4 rounded-card bg-surface p-4 text-left transition-colors duration-100 hover:bg-surface2"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-card bg-black/40 text-brand">
            <Wand2 size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-text">{t("wiz.own.title")}</span>
            <span className="mt-0.5 block text-[12.5px] text-muted">{t("wiz.own.text")}</span>
          </span>
        </button>
        <div className="flex items-center gap-3 pt-1">
          <span className="text-[12.5px] font-semibold text-muted">{debounced ? t("wiz.packs.results") : t("wiz.packs.popular")}</span>
          <div className="flex-1" />
          <SearchInput value={query} onChange={setQuery} placeholder={t("wiz.packs.search")} className="w-[260px]" />
        </div>
        <div className="scroll min-h-0 flex-1">
          {q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} className="py-8" />
          ) : !hits ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-[76px]" />
              ))}
            </div>
          ) : hits.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-[13px] text-dim">
              <Search size={20} />
              {t("wiz.packs.none")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {hits.map((h) => (
                <button
                  key={h.id}
                  onClick={() => install(h)}
                  className="group flex min-w-0 items-center gap-3 rounded-card bg-surface p-3 text-left transition-colors duration-100 hover:bg-surface2"
                >
                  <PackIcon hit={h} size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-text">{h.title}</span>
                    <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted">{h.description}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="flex items-center gap-1 text-caption tabular-nums text-dim">
                      <Download size={11} />
                      {formatCount(h.downloads)}
                    </span>
                    <span className="text-[12px] font-semibold text-brand opacity-0 transition-opacity group-hover:opacity-100">{t("wiz.pack.pick")}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <Footer>
        <AdvancedLink />
        <div className="flex-1" />
        <span className="text-[12px] text-dim">{t("wiz.packs.hint")}</span>
      </Footer>
    </>
  );
}

// ------------------------------------------------------------------ Name + Zusammenfassung

function defaultName(goal: NewGameGoal) {
  return tt(`wiz.name.${goal}`);
}

/** Was passiert, in Alltagssprache (ohne Loader, Versionen von Mod-Unterbauten usw.). */
function summary(goal: NewGameGoal, plan: GamePlan, t: ReturnType<typeof useT>): string[] {
  const lines = [plan.mc ? t("wiz.sum.version", { mc: plan.mc }) : t("wiz.sum.version_auto")];
  if (goal === "fps") lines.push(t("wiz.sum.fps"));
  if (plan.pack === "essential") lines.push(t("wiz.sum.essential"));
  if (goal === "friends" && !plan.pack) lines.push(t("wiz.sum.friends_plain"));
  if (plan.pack === "vibey") lines.push(t("wiz.sum.vibey"));
  if (goal === "friends" && plan.pack === "vibey") lines.push(t("wiz.sum.friends_vibey"));
  if (goal === "mods") lines.push(t("wiz.sum.mods"));
  lines.push(t("wiz.sum.auto"));
  return lines;
}

function DetailsStep({ goal, onDone, onBusy }: { goal: NewGameGoal; onDone: () => void; onBusy: (b: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const plan = usePlan(goal);
  const [name, setName] = useState(() => defaultName(goal));
  const [accent, setAccent] = useState(() => accentPalette[Math.floor(Math.random() * accentPalette.length)]);
  const [busy, setBusy] = useState(false);
  const ready = !plan.loading && !plan.unavailable && !!plan.mc && (plan.loader === "vanilla" || !!plan.loaderVersion);
  const valid = ready && name.trim().length > 0;

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
        group: null,
      });
      onDone();
      installInstance(inst.id);
      if (plan.pack) void installPackAfterCreate(t, inst.id, plan.pack);
      if (plan.perf) void installPerf(inst.id);
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
        className="flex min-h-0 flex-1 gap-8 px-6 pb-4 pt-2"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            void create();
          }
        }}
      >
        <div className="flex w-[300px] shrink-0 flex-col gap-5">
          {/* Vorschau, wie das Spiel in der Liste aussieht (statt eines losen Ziel-Symbols ohne Bedeutung) */}
          <div className="flex items-center gap-4 rounded-card bg-surface p-3">
            <InstanceIcon icon={null} accent={accent} size={56} />
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
            ) : plan.unavailable || !plan.mc ? (
              <div className="text-[13px] text-warn">{t(goal === "vibey" ? "wiz.sum.vibey_unavailable" : "wiz.sum.unavailable")}</div>
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
async function installPerf(instanceId: string) {
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
