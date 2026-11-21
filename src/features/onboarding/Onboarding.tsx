// Onboarding beim ersten Start (Einstellung `onboarding_done` fehlt/false) – wenige, ruhige Schritte im ganzen Fenster:
//   1. Willkommen + Sprache   2. Modus (Simple/Expert mit Vorschau)   3. Microsoft-Anmeldung (überspringbar)
//   4. Vibe an/aus   5. Import aus anderen Launchern (nur, wenn etwas gefunden wurde)   6. Erstes Spiel
// Bestehende Nutzer sehen es nie (Backend setzt `onboarding_done`), es lässt sich aber in den Einstellungen erneut
// starten. Alle Entscheidungen werden sofort gespeichert; „Fertig“ setzt nur noch das Flag.
import * as D from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Cloud,
  CloudOff,
  Gauge,
  HardDriveDownload,
  KeyRound,
  LayoutGrid,
  ListTree,
  LogIn,
  Play,
  Shirt,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAccounts, useInstances, useSettings } from "@/lib/queries";
import { patchSettings, setMode, useMode, type UiMode } from "@/lib/mode";
import { useLang, useT, type Lang } from "@/i18n";
import { Button, Spinner, Tag, cn, toast } from "@/components/ui";
import { Logo3D } from "@/components/Logo3D";
import { PlayerHead } from "@/components/PlayerHead";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { instanceAccent } from "@/lib/format";
import { MsaDialog } from "@/features/accounts/MsaDialog";
import { openImport } from "@/features/import/ImportDialog";
import { SkinImportDialog, useSkinImportScan } from "@/features/skins/SkinImport";
import { openNewGame, openNewInstance } from "@/components/instance/actions";
import { GoalTiles } from "@/features/instances/simple/goals";
import { WindowControls } from "@/app/WindowControls";
import { useOnboarding } from "./store";
import { joinWaitlist } from "@/features/access/actions";
import { useKnownApproved } from "@/features/access/hooks";
import { useVibeAccess } from "@/features/access/store";

type StepId = "welcome" | "mode" | "account" | "vibe" | "import" | "game";

export function Onboarding() {
  const settings = useSettings().data;
  const manual = useOnboarding((s) => s.open);
  const show = manual || (!!settings && !settings.onboarding_done);
  if (!show) return null;
  return <OnboardingFlow />;
}

function useImportFinds(enabled: boolean) {
  const launchers = useQuery({ queryKey: ["launchers"], queryFn: api.launchersDetect, staleTime: 60_000, retry: 0, enabled });
  const skins = useSkinImportScan(enabled);
  const found = (launchers.data ?? []).filter((l) => l.instances.length > 0);
  const newSkins = skins.data?.new_count ?? 0;
  const pending = launchers.isPending || skins.isPending;
  return { found, newSkins, pending, any: found.length > 0 || newSkins > 0 };
}

function OnboardingFlow() {
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

function OnboardingFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <D.Root open>
      <D.Content
        className="fixed inset-0 z-40 flex flex-col bg-bg focus:outline-none"
        aria-describedby={undefined}
        aria-modal="true"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
        }}
      >
        <D.Title className="sr-only">{label}</D.Title>
        {children}
      </D.Content>
    </D.Root>
  );
}

// ------------------------------------------------------------------ Bausteine

function StepHead({ eyebrow, title, lead }: { eyebrow?: string; title: string; lead?: ReactNode }) {
  return (
    <div className="mb-8">
      {eyebrow && <div className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-brand">{eyebrow}</div>}
      <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-text">{title}</h1>
      {lead && <p className="mt-2 max-w-[620px] text-[14.5px] leading-relaxed text-muted">{lead}</p>}
    </div>
  );
}

/** Große Auswahlkarte (Radio). */
function Choice({
  selected,
  onClick,
  title,
  text,
  icon,
  badge,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  text?: string;
  icon?: ReactNode;
  badge?: string;
  children?: ReactNode;
}) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "relative flex min-w-0 flex-col gap-3 rounded-panel bg-surface p-5 text-left transition-[background-color,box-shadow] duration-150",
        selected ? "bg-surface2 shadow-[inset_0_0_0_2px_var(--ui-accent)]" : "hover:bg-surface2",
      )}
    >
      {children}
      <div className="flex items-start gap-3">
        {icon && <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-card bg-black/40", selected ? "text-brand" : "text-muted")}>{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-semibold text-text">{title}</span>
            {badge && <Tag className="bg-brand/15 text-brand">{badge}</Tag>}
          </span>
          {text && <span className="mt-1 block text-[13px] leading-snug text-muted">{text}</span>}
        </span>
        <span
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded-dot border-2 transition-colors",
            selected ? "border-brand bg-brand text-[var(--ui-on-accent)]" : "border-white/25",
          )}
        >
          {selected && <Check size={12} strokeWidth={3} />}
        </span>
      </div>
    </button>
  );
}

function Bullet({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] leading-snug text-muted">
      <span className="mt-px shrink-0 text-dim">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

// ------------------------------------------------------------------ 1. Willkommen + Sprache

function WelcomeStep() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const setLang = (l: Lang) => {
    useLang.getState().setLang(l);
    patchSettings({ language: l }).catch(() => {});
  };
  return (
    <div className="flex flex-col items-center text-center">
      <Logo3D size={132} />
      <h1 className="mt-6 text-[34px] font-bold leading-tight tracking-[-0.02em] text-text">{t("onb.welcome.title")}</h1>
      <p className="mt-2 max-w-[520px] text-[15px] leading-relaxed text-muted">{t("onb.welcome.lead")}</p>
      <div className="mt-9 text-[12.5px] font-semibold text-dim">{t("onb.welcome.lang")}</div>
      <div className="mt-3 grid w-full max-w-[440px] grid-cols-2 gap-3" role="radiogroup" aria-label={t("onb.welcome.lang")}>
        {(
          [
            ["de", "Deutsch"],
            ["en", "English"],
          ] as const
        ).map(([l, label]) => (
          <button
            key={l}
            role="radio"
            aria-checked={lang === l}
            onClick={() => setLang(l)}
            className={cn(
              "flex h-14 items-center justify-center gap-2 rounded-card bg-surface text-[15px] font-semibold text-text transition-[background-color,box-shadow] duration-150",
              lang === l ? "bg-surface2 shadow-[inset_0_0_0_2px_var(--ui-accent)]" : "hover:bg-surface2",
            )}
          >
            {lang === l && <Check size={16} strokeWidth={2.5} className="text-brand" />}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 2. Modus

/** Mini-Vorschau der Oberfläche (flach, eckig): Simple = großer Spielen-Knopf + Kacheln, Expert = Liste + Werkzeuge. */
function ModePreview({ mode }: { mode: UiMode }) {
  const bar = (w: string, c = "bg-white/10") => <span className={cn("block h-1.5", c)} style={{ width: w }} />;
  return (
    <div className="flex h-[132px] overflow-hidden rounded-card bg-black/50" aria-hidden>
      {/* Seitenleiste */}
      <div className={cn("flex shrink-0 flex-col gap-1.5 bg-black/40 p-2", mode === "simple" ? "w-[74px]" : "w-[22px] items-center")}>
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

function ModeStep() {
  const t = useT();
  const mode = useMode();
  const pick = (m: UiMode) => setMode(m).catch((e) => toast.error(e));
  return (
    <>
      <StepHead eyebrow={t("onb.mode.eyebrow")} title={t("onb.mode.title")} lead={t("onb.mode.lead")} />
      <div className="grid grid-cols-2 gap-4" role="radiogroup" aria-label={t("onb.mode.title")}>
        <Choice selected={mode === "simple"} onClick={() => pick("simple")} title={t("mode.simple")} badge={t("onb.mode.recommended")} icon={<Sparkles size={19} />}>
          <ModePreview mode="simple" />
          <span className="sr-only">{t("onb.mode.simple.text")}</span>
        </Choice>
        <Choice selected={mode === "expert"} onClick={() => pick("expert")} title={t("mode.expert")} icon={<Terminal size={18} />}>
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

// ------------------------------------------------------------------ 3. Microsoft-Konto

function AccountStep() {
  const t = useT();
  const { data: accounts = [] } = useAccounts();
  const active = accounts.find((a) => a.active) ?? accounts[0];
  const [msa, setMsa] = useState(false);
  return (
    <>
      <StepHead eyebrow={t("onb.account.eyebrow")} title={t("onb.account.title")} lead={t("onb.account.lead")} />
      {active ? (
        <div className="flex items-center gap-4 rounded-panel bg-surface p-5">
          <PlayerHead uuid={active.uuid} name={active.username} size={52} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold text-text">{active.username}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ok">
              <CheckCircle2 size={14} />
              {t("onb.account.done")}
            </div>
          </div>
          <Button variant="subtle" icon={<LogIn size={14} />} onClick={() => setMsa(true)}>
            {t("acct.add")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-6 rounded-panel bg-surface p-6">
          <Button variant="primary" size="lg" icon={<LogIn size={17} />} onClick={() => setMsa(true)}>
            {t("accounts.empty.cta")}
          </Button>
          <ul className="flex flex-col gap-2.5">
            <Bullet icon={<KeyRound size={14} />}>{t("onb.account.b1")}</Bullet>
            <Bullet icon={<ShieldCheck size={14} />}>{t("onb.account.b2")}</Bullet>
            <Bullet icon={<Shirt size={14} />}>{t("onb.account.b3")}</Bullet>
          </ul>
        </div>
      )}
      <MsaDialog open={msa} onOpenChange={setMsa} />
    </>
  );
}

// ------------------------------------------------------------------ 4. Vibe

function VibeStep() {
  const t = useT();
  const s = useSettings().data;
  const on = !!s?.vibe.enabled;
  const set = (enabled: boolean) => s && patchSettings({ vibe: { ...s.vibe, enabled } }).catch((e) => toast.error(e));
  const knownOk = useKnownApproved();
  const join = useRef(false);
  join.current = on && !knownOk;
  useEffect(
    () => () => {
      const st = useVibeAccess.getState().status;
      if (join.current && st !== "waitlist" && st !== "approved") joinWaitlist().catch(() => {});
    },
    [],
  );
  return (
    <>
      <StepHead
        eyebrow={`${t("onb.vibe.eyebrow")} · ${t("access.beta")}`}
        title={t("onb.vibe.title")}
        lead={knownOk ? t("onb.vibe.lead") : t("onb.vibe.beta_lead")}
      />
      <ul className="mb-6 grid grid-cols-3 gap-3">
        {(
          [
            [<Users size={18} key="u" />, "friends"],
            [<Shirt size={18} key="s" />, "cosmetics"],
            [<Sparkles size={18} key="c" />, "client"],
          ] as const
        ).map(([icon, k]) => (
          <li key={k} className="flex flex-col gap-2 rounded-card bg-surface p-4">
            <span className="text-brand">{icon}</span>
            <span className="text-[14px] font-semibold text-text">{t(`onb.vibe.${k}`)}</span>
            <span className="text-[12.5px] leading-snug text-muted">{t(`onb.vibe.${k}.desc`)}</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-4" role="radiogroup" aria-label={t("onb.vibe.title")}>
        <Choice
          selected={on}
          onClick={() => set(true)}
          title={knownOk ? t("onb.vibe.on") : t("onb.vibe.join")}
          text={knownOk ? t("onb.vibe.on.text") : t("onb.vibe.join.text")}
          icon={<Cloud size={18} />}
        />
        <Choice selected={!on} onClick={() => set(false)} title={t("onb.vibe.off")} text={t("onb.vibe.off.text")} icon={<CloudOff size={18} />} />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ 5. Import

function ImportStep({ finds }: { finds: ReturnType<typeof useImportFinds> }) {
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
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-black/40 text-brand">
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
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-black/40 text-brand">
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

// ------------------------------------------------------------------ 6. Erstes Spiel

function GameStep({ mode, onFinish }: { mode: UiMode; onFinish: (after?: () => void) => Promise<void> }) {
  const t = useT();
  const { data: instances = [] } = useInstances();
  if (instances.length > 0) {
    return (
      <>
        <StepHead
          eyebrow={t("onb.game.ready_eyebrow")}
          title={t("onb.game.ready_title")}
          lead={t(instances.length === 1 ? "onb.game.ready_lead_one" : "onb.game.ready_lead", { n: instances.length })}
        />
        {/* Die vorhandenen Spiele zeigen, statt nur eine Zahl zu nennen */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {instances.slice(0, 4).map((i) => (
            <span key={i.id} className="flex h-11 min-w-0 max-w-[220px] items-center gap-2.5 rounded-card bg-surface pl-1.5 pr-3.5">
              <InstanceIcon icon={i.icon} seed={i.id} accent={instanceAccent(i.id, i.accent)} size={32} />
              <span className="truncate text-[13.5px] font-semibold text-text">{i.name}</span>
            </span>
          ))}
          {instances.length > 4 && <span className="px-1 text-[13px] text-dim">{t("onb.game.ready_more", { n: instances.length - 4 })}</span>}
        </div>
        <div className="flex items-center gap-3 text-[14px] text-ok">
          <CheckCircle2 size={18} />
          {t("onb.game.ready_hint")}
        </div>
      </>
    );
  }
  return (
    <>
      <StepHead eyebrow={t("onb.game.eyebrow")} title={t("onb.game.title")} lead={mode === "simple" ? t("onb.game.lead_simple") : t("onb.game.lead_expert")} />
      {mode === "simple" ? (
        <GoalTiles compact onPick={(g) => void onFinish(() => openNewGame(g))} />
      ) : (
        <div className="flex items-center gap-4 rounded-panel bg-surface p-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-black/40 text-brand">
            <LayoutGrid size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-text">{t("inst.new")}</div>
            <div className="text-[12.5px] text-muted">{t("onb.game.expert_text")}</div>
          </div>
          <Button variant="primary" onClick={() => void onFinish(openNewInstance)}>
            {t("onb.game.expert_cta")}
          </Button>
        </div>
      )}
      <p className="mt-6 text-[12.5px] text-dim">{t("onb.game.later")}</p>
    </>
  );
}
