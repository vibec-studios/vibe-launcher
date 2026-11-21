import * as Popover from "@radix-ui/react-popover";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ExternalLink, Square, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton, Spinner, Tooltip, cn } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { killInstance, openConsole } from "@/components/instance/actions";
import { useT } from "@/i18n";
import { useActiveRuns } from "@/lib/gameStore";
import { useInstances } from "@/lib/queries";
import { instanceAccent } from "@/lib/format";
import { formatUptime } from "@/lib/sessions";
import type { GameState, Instance } from "@/lib/types";
import { SessionResources } from "@/features/perf/SessionResources";

function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

const Dot = ({ run }: { run: GameState }) =>
  run.state === "preparing" ? <Spinner size={10} className="text-warn" /> : <span className="h-2 w-2 shrink-0 rounded-dot bg-ok" />;

function label(run: GameState, inst: Instance | undefined) {
  const name = inst?.name ?? run.instance_id;
  return run.slot > 1 ? `${name} #${run.slot}` : name;
}

function SingleChip({ run, inst }: { run: GameState; inst: Instance }) {
  const t = useT();
  const nav = useNavigate();
  return (
    <div className="vl-running flex h-8 items-center overflow-hidden rounded-ctl bg-surface2">
      <button
        className="flex h-full items-center gap-2 pl-2.5 pr-2.5 text-[13px] font-medium text-text hover:bg-white/[.04]"
        onClick={() => nav({ to: "/instances/$id", params: { id: inst.id }, search: { tab: "logs" } })}
      >
        <Dot run={run} />
        <span className="max-w-[160px] truncate">{label(run, inst)}</span>
      </button>
      <Tooltip content={t("common.stop")} side="bottom">
        <button aria-label={t("common.stop")} onClick={() => killInstance(inst, run.run_id)} className="grid h-full w-8 place-items-center text-muted hover:bg-danger hover:text-black">
          <Square size={11} fill="currentColor" />
        </button>
      </Tooltip>
    </div>
  );
}

function Row({ run, inst, now, onDone }: { run: GameState; inst: Instance | undefined; now: number; onDone: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const go = (tab: "logs" | "content") => {
    onDone();
    nav({ to: "/instances/$id", params: { id: run.instance_id }, search: { tab } });
  };
  return (
    <div className="group flex items-center gap-2.5 rounded-ctl px-2 py-1.5 hover:bg-white/[.05]">
      <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => go("content")}>
        <span className="relative shrink-0">
          <InstanceIcon icon={inst?.icon} accent={instanceAccent(run.instance_id, inst?.accent ?? null)} size={30} />
          <span className="absolute -bottom-0.5 -right-0.5 grid h-3 w-3 place-items-center rounded-dot bg-overlay">
            <Dot run={run} />
          </span>
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-medium text-text">{label(run, inst)}</span>
          <span className="block truncate text-[11.5px] text-muted">
            {run.account_name ?? t("sess.no_account")}
            <span className="text-dim"> · {run.state === "preparing" || !run.started_at ? t("sess.preparing") : formatUptime(now - run.started_at)}</span>
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton label={t("sess.console")} tip variant="ghost" size="sm" onClick={() => openConsole(run.run_id)}>
          <SquareTerminal size={14} />
        </IconButton>
        <IconButton label={t("sess.open_instance")} tip variant="ghost" size="sm" onClick={() => go("logs")}>
          <ExternalLink size={14} />
        </IconButton>
        <IconButton label={t("common.stop")} tip variant="ghost" size="sm" className="hover:!bg-danger hover:!text-black" onClick={() => inst && killInstance(inst, run.run_id)}>
          <Square size={12} fill="currentColor" />
        </IconButton>
      </div>
    </div>
  );
}

export function RunningGames() {
  const t = useT();
  const runs = useActiveRuns();
  const { data: instances = [] } = useInstances();
  const [open, setOpen] = useState(false);
  const now = useNow(open);
  const byId = new Map(instances.map((i) => [i.id, i]));
  const shown = runs.filter((r) => byId.has(r.instance_id));
  const newest = shown[shown.length - 1];
  const chips = !newest ? null : shown.length === 1 ? <SingleChip run={newest} inst={byId.get(newest.instance_id)!} /> : (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          aria-label={t("sess.running_title")}
          data-testid="running-sessions"
          className={cn("vl-running flex h-8 items-center gap-2 rounded-ctl bg-surface2 pl-2.5 pr-2 text-[13px] font-medium text-text hover:bg-surface3", open && "bg-surface3")}
        >
          <Dot run={newest} />
          <span className="max-w-[140px] truncate">{label(newest, byId.get(newest.instance_id))}</span>
          <span className="rounded-dot bg-white/10 px-1.5 text-[11px] font-semibold tabular-nums text-muted">+{shown.length - 1}</span>
          <ChevronDown size={14} className={cn("text-dim transition-transform", open && "rotate-180")} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[60] w-[340px] overflow-hidden rounded-card bg-overlay p-1 shadow-e2 data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          <div className="flex h-9 items-center justify-between px-2.5">
            <span className="text-[12px] font-semibold text-dim">{t("sess.running_title")}</span>
            <span className="text-[11.5px] tabular-nums text-dim">{t("sess.running_n", { n: shown.length })}</span>
          </div>
          <div className="scroll max-h-[360px]">
            {shown
              .slice()
              .reverse()
              .map((r) => (
                <Row key={r.run_id} run={r} inst={byId.get(r.instance_id)} now={now} onDone={() => setOpen(false)} />
              ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
  return (
    <>
      <SessionResources runs={shown} name={(run) => label(run, byId.get(run.instance_id))} />
      {chips}
    </>
  );
}
