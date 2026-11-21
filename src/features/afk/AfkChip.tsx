import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import { Heart, Monitor, MoonStar, PanelsTopLeft, Square, Wifi, WifiOff } from "lucide-react";
import { IconButton, Tooltip, cn } from "@/components/ui";
import { killInstance } from "@/components/instance/actions";
import { useT } from "@/i18n";
import type { GameState, Instance } from "@/lib/types";
import { afkToggle, openAfkView, useAfkEnabled } from "./AfkMenu";
import { isBackground, useAfkEvents, useAfkSession } from "./store";
import { AfkLaunchHost } from "./AfkLaunchDialog";
import type { AfkSession } from "./types";

export function connLabel(s: AfkSession | undefined, t: (k: string) => string) {
  const c = s?.status.connected;
  return c === true ? t("afk.status.connected") : c === false ? t("afk.status.disconnected") : t("afk.status.unknown");
}

function Summary({ run, inst, session, onDone }: { run: GameState; inst: Instance | undefined; session: AfkSession; onDone: () => void }) {
  const t = useT();
  const events = useAfkEvents(run.run_id, true);
  const chat = events.filter((e) => e.type === "chat" || e.type === "outgoing").slice(-4);
  const bg = isBackground(session);
  const st = session.status;
  return (
    <div className="flex flex-col gap-2.5 p-3" data-testid="afk-summary">
      <div className="flex items-center gap-2">
        <span className={cn("grid h-7 w-7 place-items-center rounded-ctl", bg ? "bg-brand/15 text-brand" : "bg-surface2 text-muted")}>{bg ? <MoonStar size={14} /> : <Monitor size={14} />}</span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold text-text">{inst?.name ?? run.instance_id}</div>
          <div className="text-[11.5px] text-muted">
            {t(bg ? "afk.state.background" : "afk.state.foreground")} · {t(`afk.agent_state.${session.agent}`)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[12px]">
        <span className="flex items-center gap-1.5 rounded-ctl bg-surface2 px-2 py-1.5 text-text">
          {st.connected === false ? <WifiOff size={12} className="text-danger" /> : <Wifi size={12} className="text-ok" />}
          <span className="truncate">{st.server ?? connLabel(session, t)}</span>
        </span>
        <span className="flex items-center gap-1.5 rounded-ctl bg-surface2 px-2 py-1.5 text-text">
          <Heart size={12} className="text-danger" />
          {st.health !== undefined ? `${Math.round(st.health)} / ${st.max_health ?? 20}` : "–"}
        </span>
      </div>
      <div className="max-h-[110px] overflow-hidden rounded-ctl bg-surface2 px-2 py-1.5 text-[12px] leading-snug">
        {chat.length === 0 ? <span className="text-dim">{t("afk.chat.empty")}</span> : chat.map((e, i) => <div key={i} className="truncate text-text">{e.type === "outgoing" ? `${t("afk.you")}: ${e.text}` : e.text}</div>)}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          className="col-span-2 flex h-8 items-center justify-center gap-1.5 rounded-ctl bg-accent px-2.5 text-[12.5px] font-semibold text-[var(--on-accent)] hover:brightness-110"
          onClick={() => {
            afkToggle(run.run_id, !bg);
            onDone();
          }}
        >
          {bg ? <Monitor size={13} /> : <MoonStar size={13} />}
          {t(bg ? "afk.to_fg" : "afk.to_bg")}
        </button>
        <button className="flex h-8 items-center justify-center gap-1.5 rounded-ctl bg-surface2 px-2.5 text-[12.5px] text-text hover:bg-surface3" onClick={() => openAfkView(run.run_id)}>
          <PanelsTopLeft size={13} />
          {t("afk.view")}
        </button>
        <button className="flex h-8 items-center justify-center gap-1.5 rounded-ctl bg-danger/12 px-2.5 text-[12.5px] text-danger hover:bg-danger hover:text-black" onClick={() => inst && killInstance(inst, run.run_id)}>
          <Square size={11} fill="currentColor" />
          {t("afk.stop")}
        </button>
      </div>
    </div>
  );
}

export function AfkChipBadge({ run, inst }: { run: GameState; inst: Instance | undefined }) {
  const t = useT();
  const enabled = useAfkEnabled();
  const session = useAfkSession(run.run_id);
  const [open, setOpen] = useState(false);
  if (!enabled || run.state !== "running" || inst?.bedrock) return null;
  if (!session || session.ended) {
    return (
      <Tooltip content={t("afk.to_bg")} side="bottom">
        <button aria-label={t("afk.to_bg")} data-testid="afk-chip-toggle" onClick={() => afkToggle(run.run_id, true)} className="grid h-full w-8 place-items-center text-muted hover:bg-white/[.06] hover:text-text">
          <MoonStar size={13} />
        </button>
      </Tooltip>
    );
  }
  const bg = isBackground(session);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          aria-label={t("afk.view")}
          data-testid="afk-chip"
          className={cn("flex h-full items-center gap-1 px-2 text-[11.5px] font-semibold", bg ? "bg-brand/15 text-brand hover:bg-brand/25" : "text-muted hover:bg-white/[.06] hover:text-text")}
        >
          {bg ? <MoonStar size={12} /> : <Monitor size={12} />}
          {t("afk.short")}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[60] w-[320px] overflow-hidden rounded-card bg-overlay shadow-e2 data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          <Summary run={run} inst={inst} session={session} onDone={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function AfkRowToggle({ run }: { run: GameState }) {
  const t = useT();
  const enabled = useAfkEnabled();
  const session = useAfkSession(run.run_id);
  if (!enabled || run.state !== "running") return null;
  const bg = isBackground(session);
  return (
    <IconButton label={t(bg ? "afk.to_fg" : "afk.to_bg")} tip variant="ghost" size="sm" className={bg ? "text-brand" : undefined} onClick={() => afkToggle(run.run_id, !bg)}>
      {bg ? <Monitor size={14} /> : <MoonStar size={14} />}
    </IconButton>
  );
}

export function AfkHost() {
  const enabled = useAfkEnabled();
  return enabled ? <AfkLaunchHost /> : null;
}
