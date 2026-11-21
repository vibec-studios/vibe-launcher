import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronRight, Compass, LogIn, Play, Plus, Users, X } from "lucide-react";
import { IconButton, cn } from "@/components/ui";
import { openNewInstance } from "@/components/instance/actions";
import { MsaDialog } from "@/features/accounts/MsaDialog";
import { openHelp } from "@/features/help/store";
import { useAccounts, useInstances } from "@/lib/queries";
import { useSimple } from "@/lib/mode";
import { useVibe } from "@/lib/vibe";
import { useT } from "@/i18n";

const KEY = "vl.starter.hidden";

function readHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function writeHidden() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    return;
  }
}

interface Step {
  id: string;
  done: boolean;
  icon: ReactNode;
  title: string;
  text: string;
  action: string;
  run: () => void;
}

export function StarterCard() {
  const t = useT();
  const nav = useNavigate();
  const simple = useSimple();
  const vibe = useVibe();
  const accounts = useAccounts();
  const instances = useInstances();
  const [hidden, setHidden] = useState(readHidden);
  const [msa, setMsa] = useState(false);
  if (hidden || !accounts.data || !instances.data) return null;
  const java = instances.data.filter((i) => !i.bedrock);
  const fresh = java.length <= 1 || java.every((i) => !i.last_played);
  if (!simple && !fresh) return null;
  const firstJava = java[0];
  const steps: Step[] = [
    {
      id: "account",
      done: accounts.data.length > 0,
      icon: <LogIn size={16} />,
      title: t("usab.start.account"),
      text: t("usab.start.account.text"),
      action: t("usab.start.account.cta"),
      run: () => setMsa(true),
    },
    {
      id: "game",
      done: java.length > 0,
      icon: <Plus size={16} />,
      title: t("usab.start.game"),
      text: t("usab.start.game.text"),
      action: t("usab.start.game.cta"),
      run: openNewInstance,
    },
    {
      id: "mods",
      done: java.some((i) => i.loader.kind !== "vanilla" || !!i.source),
      icon: <Compass size={16} />,
      title: t("usab.start.mods"),
      text: t("usab.start.mods.text"),
      action: t("usab.start.mods.cta"),
      run: () => nav({ to: "/discover", search: { type: "modpack" } }),
    },
    {
      id: "play",
      done: java.some((i) => !!i.last_played),
      icon: <Play size={16} />,
      title: t("usab.start.play"),
      text: t("usab.start.play.text"),
      action: t("usab.start.play.cta"),
      run: () => (firstJava ? nav({ to: "/instances/$id", params: { id: firstJava.id }, search: { tab: "content" } }) : openNewInstance()),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const nextId = steps.find((s) => !s.done)?.id;
  const hide = () => {
    writeHidden();
    setHidden(true);
  };
  return (
    <section data-testid="starter-card" data-tour="starter" className="rounded-panel bg-surface p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-section text-text">{t("usab.start.title")}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{t("usab.start.lead", { done: doneCount, total: steps.length })}</p>
        </div>
        <IconButton label={t("usab.start.hide")} tip variant="ghost" size="sm" onClick={hide}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-pill bg-white/[.06]">
        <div className="h-full rounded-pill bg-brand transition-[width] duration-300" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-4 grid grid-cols-2 gap-2 max-[900px]:grid-cols-1">
        {steps.map((s, i) => {
          const next = s.id === nextId;
          return (
            <li
              key={s.id}
              className={cn(
                "flex items-center gap-3 rounded-card px-3 py-2.5",
                next ? "bg-white/[.05] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ui-accent)_45%,transparent)]" : "bg-white/[.025]",
              )}
            >
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-pill text-[12.5px] font-semibold",
                  s.done ? "bg-ok/15 text-ok" : next ? "bg-brand/15 text-brand" : "bg-white/[.06] text-dim",
                )}
              >
                {s.done ? <Check size={15} strokeWidth={2.5} /> : next ? s.icon : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn("text-[13.5px] font-semibold", s.done ? "text-muted line-through decoration-1" : "text-text")}>{s.title}</div>
                {!s.done && <div className="text-[12px] leading-snug text-muted">{s.text}</div>}
              </div>
              {!s.done && (
                <button
                  type="button"
                  onClick={s.run}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1 rounded-ctl px-2.5 text-[12.5px] font-semibold transition-colors duration-100",
                    next ? "bg-brand text-[var(--on-accent)] hover:brightness-110" : "text-muted hover:bg-white/[.06] hover:text-text",
                  )}
                >
                  {s.action}
                  <ChevronRight size={13} />
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {vibe.social && (
        <button
          type="button"
          onClick={() => openHelp("hosting")}
          className="mt-3 inline-flex items-center gap-2 text-[12.5px] font-semibold text-muted transition-colors hover:text-text"
        >
          <Users size={14} />
          {t("usab.start.friends")}
          <ChevronRight size={13} />
        </button>
      )}
      <MsaDialog open={msa} onOpenChange={setMsa} />
    </section>
  );
}
