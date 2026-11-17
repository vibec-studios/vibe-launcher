// OWNER: Frontend-Agent A. Startseite im Stil der Website: Hero mit 3D-Logo, Weiterspielen, Statistik,
// zuletzt gespielte Instanzen und Schnellaktionen.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { ArrowRight, Compass, PackageOpen, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useInstances } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { formatDuration, formatRelative, instanceAccent } from "@/lib/format";
import { Button, ErrorState, Skeleton, Tag, cn } from "@/components/ui";
import { Logo3D } from "@/components/Logo3D";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { InstanceCard, LoaderTag, StatusHint } from "@/components/instance/InstanceCard";
import { PlayButton } from "@/components/instance/PlayButton";
import { openNewInstance, useInstanceActions } from "@/components/instance/actions";
import { InstanceDialogs } from "@/features/instances/InstanceDialogs";
import { gridCls } from "@/features/instances/InstancesPage";
import { openImport } from "@/features/import/ImportDialog";
import { useT } from "@/i18n";
import { accentVars } from "@/components/instance/accent";

const wrap = "mx-auto w-full max-w-[1320px] px-8";

function useWide(px: number) {
  const [wide, setWide] = useState(() => window.innerWidth >= px);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= px);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [px]);
  return wide;
}

/** Summe installierter Mods über alle Modloader-Instanzen (geteilter Cache mit dem Inhalte-Tab). */
function useModCount(instances: Instance[]): number | null {
  const targets = instances.filter((i) => i.loader.kind !== "vanilla").slice(0, 80);
  return useQueries({
    queries: targets.map((i) => ({
      queryKey: qk.content(i.id, "mod"),
      queryFn: () => api.contentList(i.id, "mod"),
      staleTime: 60_000,
      retry: 0,
    })),
    combine: (rs) => {
      if (!rs.length) return 0;
      if (rs.every((r) => !r.data)) return null;
      return rs.reduce((n, r) => n + (r.data?.length ?? 0), 0);
    },
  });
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1.5 py-5 pr-4 [&+&]:border-l [&+&]:border-line [&+&]:pl-6">
      <b className="whitespace-nowrap font-display text-[26px] leading-none text-white">{value}</b>
      <span className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[.08em] text-dim">{label}</span>
    </div>
  );
}

function ContinueCard({ instance: i }: { instance: Instance }) {
  const t = useT();
  const { open } = useInstanceActions();
  const accent = instanceAccent(i.id, i.accent);
  return (
    <div
      className="mt-8 flex items-center gap-5 border border-line2 bg-black/55 p-4 pr-4 shadow-[inset_3px_0_0_var(--accent)] animate-fade-in"
      style={accentVars(accent)}
    >
      <button onClick={() => open(i)} className="shrink-0" aria-label={i.name}>
        <InstanceIcon icon={i.icon} accent={accent} size={68} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="eyebrow mb-1.5 truncate">
          {i.last_played ? t("home.continue") : t("home.ready")}
          {i.last_played && <span className="text-dim"> · {formatRelative(i.last_played)}</span>}
        </p>
        <button
          onClick={() => open(i)}
          className="block max-w-full truncate text-left font-display text-[20px] font-bold uppercase leading-tight text-white hover:text-accent"
        >
          {i.name}
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-dim">
          <Tag>{i.mc_version}</Tag>
          <LoaderTag instance={i} />
          {i.play_time_secs > 0 && <span className="ml-1.5">{formatDuration(i.play_time_secs)}</span>}
          <span className="ml-1.5">
            <StatusHint instance={i} />
          </span>
        </div>
      </div>
      <PlayButton instance={i} size="lg" className="min-w-[170px]" />
    </div>
  );
}

function ActionTile({ tag, title, text, icon, onClick, to }: { tag: string; title: string; text: string; icon: ReactNode; onClick?: () => void; to?: string }) {
  const inner = (
    <>
      <span className="mb-7 flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[.12em] text-accent">
        {icon}
        {tag}
      </span>
      <h3 className="mb-1.5 text-[16px] font-semibold leading-snug text-white">{title}</h3>
      <p className="text-[13px] leading-relaxed text-muted">{text}</p>
      <ArrowRight
        size={16}
        className="absolute right-6 top-6 text-dim transition-[transform,color] duration-150 group-hover:translate-x-1 group-hover:text-white"
      />
    </>
  );
  const cls = "group relative block border-b border-r border-line bg-surface px-6 pb-7 pt-6 text-left transition-colors duration-150 hover:bg-surface2";
  return to ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export function HomePage() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useInstances();
  const { open } = useInstanceActions();
  const onOpen = useCallback((i: Instance) => open(i), [open]);
  const wide = useWide(1180);
  const list = useMemo(() => data ?? [], [data]);

  const recent = useMemo(() => list.slice().sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0) || b.created_at - a.created_at), [list]);
  const hero = recent[0];
  const others = recent.slice(1, 5);
  const totalTime = list.reduce((n, i) => n + i.play_time_secs, 0);
  const mods = useModCount(list);
  const packs = list.filter((i) => i.source).length;
  const tint = hero ? instanceAccent(hero.id, hero.accent) : "#8b6cff";
  const empty = !isLoading && list.length === 0 && !isError;

  return (
    <div className="scroll h-full">
      <InstanceDialogs />
      <section
        className="relative overflow-hidden border-b border-line"
        style={{ background: `radial-gradient(55% 75% at 80% 50%, color-mix(in srgb, ${tint} 17%, transparent), transparent 72%)` }}
      >
        <div
          className={cn(
            wrap,
            "grid min-h-[340px] items-center gap-6 pb-9 pt-10",
            wide ? "grid-cols-[minmax(0,1.25fr)_minmax(0,.75fr)]" : "grid-cols-[minmax(0,1fr)_240px]",
          )}
        >
          <div className="min-w-0">
            <p className="eyebrow mb-3.5">{empty ? t("home.eyebrow.new") : t("home.eyebrow")}</p>
            <h1 className="display text-balance text-[clamp(30px,3.6vw,48px)]">{empty ? t("home.title.new") : t("home.title")}</h1>
            <p className="mt-4 max-w-[560px] text-[16px] leading-relaxed text-muted">{empty ? t("home.lead.new") : t("home.lead")}</p>
            {isError && !data ? (
              <ErrorState error={error} onRetry={() => refetch()} className="items-start px-0 py-6 text-left" />
            ) : isLoading && !data ? (
              <div className="mt-8 flex items-center gap-5 border border-line p-4">
                <Skeleton className="h-[68px] w-[68px]" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-6 w-56" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <Skeleton className="h-[52px] w-[190px]" />
              </div>
            ) : hero ? (
              <ContinueCard instance={hero} />
            ) : (
              <>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Button variant="primary" size="lg" icon={<Plus size={16} />} onClick={openNewInstance} className="min-w-[240px]">
                    {t("inst.new")}
                  </Button>
                  <Button size="lg" icon={<PackageOpen size={15} />} onClick={() => openImport()}>
                    {t("home.action.import")}
                  </Button>
                </div>
                <p className="mt-5 font-mono text-[12px] text-dim">└─ {t("home.note")}</p>
              </>
            )}
          </div>
          <div className="relative grid place-items-center">
            <Logo3D size={wide ? 320 : 230} />
          </div>
        </div>
        {!empty && (
          <div className={cn(wrap, "grid grid-cols-4 border-t border-line")}>
            <Stat value={isLoading && !data ? "–" : list.length} label={t("home.stat.instances")} />
            <Stat value={totalTime > 0 ? formatDuration(totalTime).replace(/ \d+ min$/, "") : "0 h"} label={t("home.stat.playtime")} />
            <Stat value={mods ?? "–"} label={t("home.stat.mods")} />
            <Stat value={packs} label={t("home.stat.packs")} />
          </div>
        )}
      </section>

      {others.length > 0 && (
        <section className={cn(wrap, "pt-10")}>
          <div className="mb-4 flex items-center gap-4">
            <h2 className="label text-muted">{t("nav.recent")}</h2>
            <span className="h-px flex-1 bg-line" />
            <Link to="/instances" className="group flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[.1em] text-dim hover:text-white">
              {t("home.all_instances")}
              <ArrowRight size={13} className="transition-transform duration-150 group-hover:translate-x-0.5" />
            </Link>
          </div>
          <div className={gridCls}>
            {others.map((i) => (
              <InstanceCard key={i.id} instance={i} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}

      <section className={cn(wrap, "pb-12 pt-10")}>
        <div className="mb-4 flex items-center gap-4">
          <h2 className="label text-muted">{empty ? t("home.steps") : t("home.actions")}</h2>
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="grid grid-cols-3 border-l border-t border-line">
          <ActionTile
            tag={empty ? "01" : t("home.action.new.tag")}
            icon={<Plus size={13} />}
            title={t("inst.new")}
            text={t("home.action.new.text")}
            onClick={openNewInstance}
          />
          <ActionTile
            tag={empty ? "02" : t("home.action.import.tag")}
            icon={<PackageOpen size={13} />}
            title={t("home.action.import")}
            text={t("home.action.import.text")}
            onClick={() => openImport()}
          />
          <ActionTile
            tag={empty ? "03" : t("home.action.discover.tag")}
            icon={<Compass size={13} />}
            title={t("nav.discover")}
            text={t("home.action.discover.text")}
            to="/discover"
          />
        </div>
      </section>
    </div>
  );
}
