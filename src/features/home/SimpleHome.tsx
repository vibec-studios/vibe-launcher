// Startseite im Simple-Modus: ein großer Spielen-Knopf für das zuletzt gespielte Spiel, darunter große Kacheln
// „Neues Spiel“ (nach Ziel) und die übrigen Spiele zum direkten Starten. Ohne Konto ein klarer Hinweis zur Anmeldung.
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, LogIn } from "lucide-react";
import { useAccounts, useInstances } from "@/lib/queries";
import { formatRelative, instanceAccent } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { Button, Skeleton, cn } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { StatusHint } from "@/components/instance/InstanceCard";
import { PlayButton } from "@/components/instance/PlayButton";
import { accentVars } from "@/components/instance/accent";
import { openNewGame } from "@/components/instance/actions";
import { MsaDialog } from "@/features/accounts/MsaDialog";
import { GoalTiles } from "@/features/instances/simple/goals";
import { useT } from "@/i18n";
import { byRecent, useFitColumns } from "./data";

const ROWS = 2;

function Hero({ instance: i }: { instance: Instance }) {
  const t = useT();
  const nav = useNavigate();
  const accent = instanceAccent(i.id, i.accent);
  return (
    <section className="flex items-center gap-6 rounded-panel bg-surface p-6" style={accentVars(accent)}>
      <button onClick={() => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "content" } })} className="shrink-0" aria-label={i.name}>
        <InstanceIcon icon={i.icon} accent={accent} size={96} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-muted">{i.last_played ? t("shome.continue") : t("shome.ready")}</div>
        <h2 className="mt-1 truncate text-[28px] font-bold leading-tight tracking-[-0.015em] text-text">{i.name}</h2>
        <div className="mt-1.5 truncate text-[13px] text-muted">
          {i.last_played ? t("inst.meta.last", { when: formatRelative(i.last_played) }) : t("inst.never_played")}
          <span className="ml-2 empty:hidden">
            <StatusHint instance={i} />
          </span>
        </div>
      </div>
      <div data-tour="play" className="shrink-0">
        <PlayButton instance={i} size="lg" className="h-14 min-w-[220px] text-[17px]" />
      </div>
    </section>
  );
}

function GameRow({ instance: i }: { instance: Instance }) {
  const t = useT();
  const nav = useNavigate();
  const accent = instanceAccent(i.id, i.accent);
  return (
    <div className="group flex min-w-0 items-center gap-3 rounded-card bg-surface p-3 transition-colors duration-100 hover:bg-surface2" style={accentVars(accent)}>
      <button
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "content" } })}
      >
        <InstanceIcon icon={i.icon} accent={accent} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-text">{i.name}</span>
          <span className="block truncate text-[12px] text-muted">
            {i.last_played ? t("inst.meta.last", { when: formatRelative(i.last_played) }) : t("inst.never_played")}
          </span>
        </span>
      </button>
      <PlayButton instance={i} size="icon" subtle />
    </div>
  );
}

function SignInCard() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <section className="flex items-center gap-4 rounded-panel bg-surface p-5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ui-accent)_40%,transparent)]">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-card bg-brand/15 text-brand">
        <LogIn size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-text">{t("shome.signin.title")}</div>
        <div className="text-[13px] text-muted">{t("shome.signin.text")}</div>
      </div>
      <Button variant="primary" icon={<LogIn size={15} />} onClick={() => setOpen(true)}>
        {t("accounts.empty.cta")}
      </Button>
      <MsaDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}

export function SimpleHome() {
  const t = useT();
  const nav = useNavigate();
  const { data, isLoading } = useInstances();
  const { data: accounts, isLoading: accLoading } = useAccounts();
  const active = accounts?.find((a) => a.active) ?? accounts?.[0];
  const list = useMemo(() => byRecent(data ?? []), [data]);
  const hero = list[0];
  const [gridRef, cols] = useFitColumns<HTMLDivElement>(300);
  const more = list.slice(1, 1 + cols * ROWS);
  const loading = isLoading && !data;

  return (
    <div className="scroll h-full">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-8 pb-12 pt-8">
        <header>
          <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-text">{active ? t("shome.hello_name", { name: active.username }) : t("shome.hello")}</h1>
          <p className="mt-1 text-[14.5px] text-muted">{hero ? t("shome.lead") : t("shome.lead_empty")}</p>
        </header>

        {!accLoading && !active && <SignInCard />}

        {loading ? <Skeleton className="h-[144px] rounded-panel" /> : hero && <Hero key={hero.id} instance={hero} />}

        <section className="flex flex-col gap-3">
          <h2 className="text-section text-text">{t("shome.new")}</h2>
          <GoalTiles onPick={openNewGame} />
        </section>

        {more.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center">
              <h2 className="flex-1 text-section text-text">{t("shome.more")}</h2>
              <button
                onClick={() => nav({ to: "/instances" })}
                className={cn("flex items-center gap-1 text-[13px] font-semibold text-muted transition-colors hover:text-text")}
              >
                {t("shome.all", { n: list.length })}
                <ChevronRight size={14} />
              </button>
            </div>
            <div ref={gridRef} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {more.map((i) => (
                <GameRow key={i.id} instance={i} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
