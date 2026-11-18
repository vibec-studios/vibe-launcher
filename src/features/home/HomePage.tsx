// OWNER: Frontend-Agent A. Startseite mit Minecraft-Charakter: die zuletzt gespielten Instanzen liegen in einer
// Hotbar (1–9 wählen, Mausrad wechselt, Enter/Doppelklick spielt); darüber die Auswahl mit großem Spielen-Knopf und
// „Direkt in die Welt“ (Quick Play), darunter die neuesten Screenshots.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEvent } from "@/lib/events";
import { ChevronRight, Clock, FolderOpen, Globe2, HardDriveDownload, PackageOpen, Play, Plus, RefreshCw, Server } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useAccounts, useGameStore, useInstances, useTaskStore } from "@/lib/queries";
import type { Instance, RecentServer, World } from "@/lib/types";
import { formatDuration, formatRelative, imageSrc, instanceAccent, loaderNames } from "@/lib/format";
import { Button, ContextMenu, IconButton, Skeleton, Tooltip, cn } from "@/components/ui";
import { Logo3D } from "@/components/Logo3D";
import { InstanceIcon, PixelBlock } from "@/components/instance/InstanceIcon";
import { InstanceStatus } from "@/components/instance/InstanceCard";
import { InstanceContextMenuContent } from "@/components/instance/InstanceMenu";
import { PlayButton } from "@/components/instance/PlayButton";
import { accentVars } from "@/components/instance/accent";
import { openFolder, openNewInstance, supportsQuickPlay, useInstanceActions } from "@/components/instance/actions";
import { useRunPhase } from "@/components/instance/status";
import { openImport } from "@/features/import/ImportDialog";
import { ShotThumb, openShot, useScreenshots } from "@/features/screenshots/shots";
import { useT } from "@/i18n";
import { PingBars, usePing } from "@/components/instance/motd";
import { useWeekPlaytime } from "@/features/stats/StatsPage";

const SLOTS = 9;
// Hotbar-Optik wie im Spiel: dunkle, eingelassene Slots, ausgewählter Slot mit hellem Rahmen
const BAR = "hotbar inline-flex border-2 border-[#2b2b34] bg-[#0b0b0f] p-[3px]";
const SLOT =
  "m-px bg-[#17171d] shadow-[inset_2px_2px_0_rgba(0,0,0,.6),inset_-2px_-2px_0_rgba(255,255,255,.07)] transition-colors duration-100 hover:bg-[#1e1e26]";
const SEL =
  "relative z-10 bg-[#22222b] outline outline-[3px] outline-offset-0 outline-[#ececec] shadow-[inset_0_0_0_1px_#000,0_0_0_4px_#000] hover:bg-[#22222b]";
const SEL_KEY = "vl.home.selected";

function loadSel(): string | null {
  try {
    return localStorage.getItem(SEL_KEY);
  } catch {
    return null;
  }
}
function saveSel(id: string) {
  try {
    localStorage.setItem(SEL_KEY, id);
  } catch {
    /* egal */
  }
}

function SectionHead({ title, link }: { title: string; link?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <h2 className="min-w-0 flex-1 truncate text-section text-text">{title}</h2>
      {link}
    </div>
  );
}

// ------------------------------------------------------------------ Hotbar

const HotbarSlot = memo(function HotbarSlot({
  instance: i,
  index,
  selected,
  onSelect,
  onPlay,
}: {
  instance: Instance;
  index: number;
  selected: boolean;
  onSelect: (i: Instance) => void;
  onPlay: (i: Instance) => void;
}) {
  const { phase } = useRunPhase(i.id);
  const accent = instanceAccent(i.id, i.accent);
  return (
    <ContextMenu content={<InstanceContextMenuContent instance={i} />}>
      <button
        aria-label={i.name}
        aria-pressed={selected}
        onClick={() => onSelect(i)}
        onDoubleClick={() => onPlay(i)}
        className={cn(SLOT, "relative grid h-[62px] w-[62px] shrink-0 place-items-center", selected && SEL)}
      >
        <InstanceIcon icon={i.icon} accent={accent} size={52} className="bg-transparent!" />
        <span className="absolute left-1.5 top-0.5 font-mono text-[11px] text-white/45">{index + 1}</span>
        {phase === "running" && <span className="absolute bottom-1 right-1 h-2 w-2 bg-ok shadow-[0_0_0_1px_#000]" />}
        {(phase === "busy" || phase === "preparing") && <span className="absolute bottom-1 right-1 h-2 w-2 animate-pulse bg-warn shadow-[0_0_0_1px_#000]" />}
      </button>
    </ContextMenu>
  );
});

function Hotbar({
  items,
  selectedId,
  onSelect,
  onPlay,
}: {
  items: Instance[];
  selectedId: string | null;
  onSelect: (i: Instance) => void;
  onPlay: (i: Instance) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef({ items, selectedId, onSelect });
  state.current = { items, selectedId, onSelect };

  // Mausrad wechselt den Slot – nur, solange die Maus über der Hotbar ist (wie im Spiel, mit Umlauf)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { items, selectedId, onSelect } = state.current;
      if (!items.length || e.ctrlKey) return;
      e.preventDefault();
      const cur = Math.max(
        0,
        items.findIndex((i) => i.id === selectedId),
      );
      const next = (cur + (e.deltaY > 0 ? 1 : -1) + items.length) % items.length;
      onSelect(items[next]);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={ref} className={BAR} role="toolbar" aria-label={t("home.hotbar")}>
        {Array.from({ length: SLOTS }, (_, n) => {
          const i = items[n];
          if (i) return <HotbarSlot key={i.id} instance={i} index={n} selected={i.id === selectedId} onSelect={onSelect} onPlay={onPlay} />;
          if (n === items.length)
            return (
              <Tooltip key="new" content={t("inst.new")}>
                <button aria-label={t("inst.new")} onClick={openNewInstance} className={cn(SLOT, "group grid h-[62px] w-[62px] place-items-center")}>
                  <Plus size={20} className="text-white/35 transition-colors group-hover:text-white" />
                </button>
              </Tooltip>
            );
          return <div key={`e${n}`} className={cn(SLOT, "h-[72px] w-[72px] hover:bg-[#17171d]")} />;
        })}
      </div>
      <p className="text-caption text-dim">{t("home.hotbar_hint")}</p>
    </div>
  );
}

// ------------------------------------------------------------------ Auswahl

function WorldButton({ world, instance, disabled }: { world: World; instance: Instance; disabled: boolean }) {
  const t = useT();
  const { launch } = useInstanceActions();
  const [failed, setFailed] = useState(false);
  const src = imageSrc(world.icon);
  const gm = world.game_mode?.toLowerCase();
  const mode = gm && ["survival", "creative", "adventure", "spectator", "hardcore"].includes(gm) ? t(`worlds.mode.${gm}`) : null;
  return (
    <Tooltip content={t("home.world_play", { name: world.name })}>
      <button
        disabled={disabled}
        onClick={() => launch(instance, world.folder)}
        className="group flex min-w-0 items-center gap-2.5 rounded-card bg-white/[.04] p-1.5 pr-3 text-left transition-colors duration-100 hover:bg-white/[.08] disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-ctl bg-surface2">
          {src && !failed ? (
            <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover [image-rendering:pixelated]" />
          ) : (
            <PixelBlock color="#5fbf4a" size={24} />
          )}
          <span className="absolute inset-0 grid place-items-center bg-accent text-[var(--on-accent)] opacity-0 transition-opacity duration-100 group-hover:opacity-100">
            <Play size={15} fill="currentColor" />
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-text">{world.name}</span>
          <span className="block truncate text-[12px] text-muted">
            {[mode, world.last_played ? formatRelative(world.last_played) : null].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
    </Tooltip>
  );
}

function WorldsRow({ instance }: { instance: Instance }) {
  const t = useT();
  const nav = useNavigate();
  const { phase } = useRunPhase(instance.id);
  const quick = supportsQuickPlay(instance.mc_version);
  const q = useQuery({ queryKey: qk.worlds(instance.id), queryFn: () => api.worldsList(instance.id), enabled: quick });
  const worlds = useMemo(
    () =>
      (q.data ?? [])
        .slice()
        .sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0))
        .slice(0, 4),
    [q.data],
  );
  if (!quick) return null;
  return (
    <div className="relative flex items-center gap-3 px-5 pb-4">
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold text-muted">
        <Globe2 size={14} />
        {t("home.worlds")}
      </span>
      {!q.data ? (
        <div className="flex flex-1 gap-2">
          <Skeleton className="h-[50px] w-[200px]" />
          <Skeleton className="h-[50px] w-[200px]" />
        </div>
      ) : worlds.length === 0 ? (
        <span className="flex-1 text-[13px] text-dim">{t("home.no_worlds")}</span>
      ) : (
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
          {worlds.map((w) => (
            <WorldButton key={w.folder} world={w} instance={instance} disabled={phase !== "idle"} />
          ))}
        </div>
      )}
      {q.data && q.data.length > worlds.length && (
        <button
          onClick={() => nav({ to: "/instances/$id", params: { id: instance.id }, search: { tab: "worlds" } })}
          className="shrink-0 text-[12.5px] font-medium text-muted hover:text-text"
        >
          {t("home.all_worlds", { n: q.data.length })}
        </button>
      )}
    </div>
  );
}

/** Kurzer Wert in der Statuszeile (Symbol + Text). */
function Stat({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap" title={title}>
      <span className="shrink-0 text-dim">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
}

function SelectedPanel({ instance: i }: { instance: Instance }) {
  const t = useT();
  const nav = useNavigate();
  const accent = instanceAccent(i.id, i.accent);
  const { phase } = useRunPhase(i.id);
  const modded = i.loader.kind !== "vanilla";
  const mods = useQuery({ queryKey: qk.content(i.id, "mod"), queryFn: () => api.contentList(i.id, "mod"), enabled: modded, staleTime: 60_000 });
  const updates = useQuery({
    queryKey: qk.contentUpdates(i.id),
    queryFn: () => api.contentCheckUpdates(i.id),
    enabled: modded && i.install_state === "installed",
    staleTime: 30 * 60_000,
    retry: 0,
  });
  const nUpdates = updates.data?.length ?? 0;
  const open = (tab: "content" | "settings") => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab } });

  const status =
    phase === "idle" && nUpdates > 0 ? (
      <button onClick={() => open("content")} className="inline-flex items-center gap-1.5 font-medium text-warn hover:underline">
        <RefreshCw size={12} />
        {t("home.updates", { n: nUpdates })}
      </button>
    ) : phase === "idle" && i.install_state === "installed" ? (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-dot bg-ok" />
        {modded && mods.data ? t(mods.data.length === 1 ? "home.ready_mods_one" : "home.ready_mods", { n: mods.data.length }) : t("home.ready")}
      </span>
    ) : phase === "idle" && i.install_state === "not_installed" ? (
      <span className="inline-flex items-center gap-1.5">
        <HardDriveDownload size={12} />
        {t("home.installs_on_start")}
      </span>
    ) : (
      <InstanceStatus instance={i} />
    );

  // Bühne: die gewählte Instanz ist das Wichtigste der Seite – größte Schrift, ein klarer Spielen-Knopf. Flach.
  return (
    <section className="relative overflow-hidden rounded-panel bg-surface" style={accentVars(accent)}>
      <div className="relative flex items-center gap-5 p-5">
        <button onClick={() => open("content")} aria-label={i.name} className="shrink-0">
          <InstanceIcon icon={i.icon} accent={accent} size={84} />
        </button>
        <div className="min-w-0 flex-1">
          <button onClick={() => open("content")} className="block max-w-full truncate text-left text-hero text-text hover:underline">
            {i.name}
          </button>
          <div className="mt-1 truncate text-meta text-muted">
            {i.loader.kind === "vanilla" ? "Vanilla" : `${loaderNames[i.loader.kind]} ${i.loader.version ?? ""}`} · Minecraft {i.mc_version}
            {i.source && ` · ${i.source.name ?? t("inst.modpack")}`}
          </div>
          <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted">
            <Stat icon={<Clock size={13} />} title={t("inst.play_time")}>
              {i.play_time_secs >= 60 ? formatDuration(i.play_time_secs) : "–"}
              <span className="text-dim"> · </span>
              {i.last_played ? formatRelative(i.last_played) : t("inst.never_played")}
            </Stat>
            <span className="flex min-w-0 items-center text-text">{status}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PlayButton instance={i} size="lg" className="min-w-[176px]" />
          <Button size="lg" variant="ghost" className="px-5" onClick={() => open("content")}>
            {t("inst.open")}
          </Button>
          <Tooltip content={t("common.open_folder")}>
            <IconButton label={t("common.open_folder")} className="h-11 w-11" onClick={() => openFolder(i)}>
              <FolderOpen size={17} />
            </IconButton>
          </Tooltip>
        </div>
      </div>
      <WorldsRow instance={i} />
    </section>
  );
}

// ------------------------------------------------------------------ Screenshots

function RecentServerCard({ s, instance }: { s: RecentServer; instance: Instance }) {
  const t = useT();
  const { launch } = useInstanceActions();
  const { phase } = useRunPhase(instance.id);
  const ping = usePing(s.address);
  const st = ping.data;
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-card bg-surface p-2 pr-2.5 transition-colors duration-100 hover:bg-surface2">
      <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-ctl bg-surface2">
        {st?.favicon ? <img src={st.favicon} alt="" className="h-full w-full [image-rendering:pixelated]" /> : <Server size={18} className="text-dim" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-[13px] font-semibold text-text">{s.address}</span>
          <PingBars status={st} />
        </div>
        <div className="truncate text-[12px] text-muted">
          {st?.online && st.players_online != null
            ? `${st.players_online}/${st.players_max} ${t("servers.players")} · `
            : st && !st.online
              ? `${t("servers.offline")} · `
              : ""}
          {instance.name} · {formatRelative(s.last_played)}
        </div>
      </div>
      <IconButton
        label={t("servers.join_with", { name: instance.name })}
        tip
        size="sm"
        variant="ghost"
        disabled={phase !== "idle"}
        className="text-accent"
        onClick={() => launch(instance, null, s.address)}
        style={accentVars(instanceAccent(instance.id, instance.accent))}
      >
        <Play size={14} fill="currentColor" />
      </IconButton>
    </div>
  );
}

function RecentServers() {
  const t = useT();
  const { data: instances = [] } = useInstances();
  const q = useQuery({ queryKey: ["servers-recent"], queryFn: () => api.serversRecent(4), staleTime: 30_000 });
  const rows = (q.data ?? []).map((s) => ({ s, i: instances.find((x) => x.id === s.instance_id) })).filter((r) => r.i);
  if (!rows.length) return null;
  return (
    <section>
      <SectionHead title={t("home.recent_servers")} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-2">
        {rows.map(({ s, i }) => (
          <RecentServerCard key={s.address} s={s} instance={i!} />
        ))}
      </div>
    </section>
  );
}

function RecentShots() {
  const t = useT();
  const nav = useNavigate();
  const q = useScreenshots(null);
  const shots = (q.data ?? []).slice(0, 6);
  if (!shots.length) return null;
  return (
    <section>
      <SectionHead
        title={t("home.recent_shots")}
        link={
          <Link to="/screenshots" className="group flex shrink-0 items-center gap-0.5 text-[12.5px] font-medium text-muted hover:text-text">
            {t("home.all_shots")}
            <ChevronRight size={15} className="transition-transform duration-150 group-hover:translate-x-0.5" />
          </Link>
        }
      />
      <div className="grid grid-cols-6 gap-2">
        {shots.map((s) => (
          <button
            key={s.path}
            onClick={() => {
              openShot(s.path);
              nav({ to: "/screenshots", search: {} });
            }}
            className="group relative aspect-video overflow-hidden rounded-card bg-surface transition-opacity duration-100 hover:opacity-85"
            title={`${s.file_name} · ${formatRelative(s.taken_at)}`}
          >
            <ShotThumb path={s.path} className="absolute inset-0" />
          </button>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Seite

function EmptyStart() {
  const t = useT();
  return (
    <section className="flex items-center gap-5 rounded-panel bg-surface p-5">
      <Logo3D size={88} />
      <div className="min-w-0 flex-1">
        <div className="text-title text-text">{t("home.empty.title")}</div>
        <p className="mt-1 max-w-[520px] text-[13px] text-muted">{t("home.empty.text")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" icon={<Plus size={16} />} onClick={openNewInstance}>
            {t("inst.new")}
          </Button>
          <Button icon={<PackageOpen size={15} />} onClick={() => openImport()}>
            {t("home.import_file")}
          </Button>
          <Button icon={<HardDriveDownload size={15} />} onClick={() => openImport(null, "launcher")}>
            {t("home.import_launcher")}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  const t = useT();
  const { data, isLoading } = useInstances();
  const { data: accounts = [] } = useAccounts();
  const { launch } = useInstanceActions();
  const active = accounts.find((a) => a.active) ?? accounts[0];
  const [selectedId, setSelectedId] = useState<string | null>(loadSel);

  const list = useMemo(() => data ?? [], [data]);
  const hotbar = useMemo(
    () =>
      list
        .slice()
        .sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0) || b.created_at - a.created_at)
        .slice(0, SLOTS),
    [list],
  );
  const selected = hotbar.find((i) => i.id === selectedId) ?? hotbar[0];
  const totalTime = list.reduce((n, i) => n + i.play_time_secs, 0);
  const week = useWeekPlaytime();
  // Nach dem Spielen: Wochenzeit und zuletzt gespielte Server neu laden
  const qc = useQueryClient();
  useEvent("game://state", (s) => {
    if (s.state === "stopped") {
      qc.invalidateQueries({ queryKey: ["playtime"] });
      qc.invalidateQueries({ queryKey: ["servers-recent"] });
    }
  });

  const select = useCallback((i: Instance) => {
    setSelectedId(i.id);
    saveSel(i.id);
  }, []);
  const play = useCallback((i: Instance) => launch(i), [launch]);

  // Tasten 1–9 wählen, Enter spielt (nicht, während getippt wird oder ein Dialog/Menü offen ist)
  const keys = useRef({ hotbar, selected, select, play });
  keys.current = { hotbar, selected, select, play };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")) return;
      if (document.querySelector("[role='dialog'], [role='menu']")) return;
      const { hotbar, selected, select, play } = keys.current;
      if (/^[1-9]$/.test(e.key)) {
        const i = hotbar[Number(e.key) - 1];
        if (i) {
          e.preventDefault();
          select(i);
        }
      } else if (e.key === "Enter" && selected && (el === document.body || el?.closest(".hotbar"))) {
        e.preventDefault();
        if (phaseSnapshot(selected.id) === "idle") play(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="scroll h-full">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-6 pb-10 pt-5">
        <header className="flex items-center gap-3">
          <Logo3D size={34} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-title text-text">{active ? t("home.welcome_name", { name: active.username }) : t("home.welcome")}</h1>
            {list.length > 0 && (
              <p className="text-meta text-muted">
                {t("home.summary", { n: list.length })}
                {totalTime >= 60 && ` · ${t("inst.meta.played", { time: formatDuration(totalTime) })}`}
                {" · "}
                <Link to="/stats" className="text-muted underline decoration-line2 underline-offset-2 hover:text-text">
                  {t("home.week", { time: week.data && week.data >= 60 ? formatDuration(week.data) : "0 min" })}
                </Link>
              </p>
            )}
          </div>
          {list.length > 0 && (
            <>
              <Button size="sm" variant="subtle" icon={<PackageOpen size={14} />} onClick={() => openImport()}>
                {t("home.action.import")}
              </Button>
              <Button size="sm" icon={<Plus size={15} />} onClick={openNewInstance}>
                {t("inst.new")}
              </Button>
            </>
          )}
        </header>

        {isLoading && !data ? (
          <div className="flex flex-col gap-5">
            <Skeleton className="h-[170px]" />
            <Skeleton className="mx-auto h-[82px] w-[680px]" />
          </div>
        ) : !selected ? (
          <>
            <EmptyStart />
            <Hotbar items={[]} selectedId={null} onSelect={select} onPlay={play} />
          </>
        ) : (
          <>
            <SelectedPanel key={selected.id} instance={selected} />
            <Hotbar items={hotbar} selectedId={selected.id} onSelect={select} onPlay={play} />
          </>
        )}

        <RecentServers />
        <RecentShots />
      </div>
    </div>
  );
}

/** Spielzustand ohne Abo (für Tastendrücke). */
function phaseSnapshot(id: string): "idle" | "busy" {
  const g = useGameStore.getState().states[id];
  if (g && g.state !== "stopped") return "busy";
  for (const t of Object.values(useTaskStore.getState().tasks)) if (t.instance_id === id && t.status === "running") return "busy";
  return "idle";
}
