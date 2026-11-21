// OWNER: Frontend-Agent A. Spielzeit-Statistik: letzte 7/30 Tage bzw. 12 Monate. Oben drei Kennzahlen mit Einordnung
// (an wie vielen Tagen, Ø pro Sitzung, Anteil der meistgespielten Instanz), darunter Balken je Tag bzw. Monat und die
// Aufteilung je Instanz (Zeile öffnet die Instanz). Ohne Spielzeit im Zeitraum: ein Leerzustand mit nächstem Schritt.
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BarChart3, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useInstances } from "@/lib/queries";
import { formatDuration, instanceAccent } from "@/lib/format";
import { Button, EmptyState, ErrorState, Segmented, Skeleton, Tooltip, cn, pageWrap } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { useLang, useT } from "@/i18n";
import { sumIn } from "./playtime";

type Range = "week" | "month" | "year";

const DAY = 86_400_000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Beginn des Bereichs und Buckets (Tage bzw. Monate). */
function buckets(range: Range, now = Date.now()): { start: number; edges: number[] } {
  if (range === "year") {
    const d = new Date(now);
    const edges: number[] = [];
    for (let m = 11; m >= 0; m--) edges.push(new Date(d.getFullYear(), d.getMonth() - m, 1).getTime());
    return { start: edges[0], edges };
  }
  const days = range === "week" ? 7 : 30;
  const today = startOfDay(now);
  const edges = Array.from({ length: days }, (_, i) => today - (days - 1 - i) * DAY);
  return { start: edges[0], edges };
}

/** Dauer für Kennzahlen: ab 100 h ohne Minuten („421 h“ statt „421 h 14 min“). */
function duration(s: number): string {
  if (s <= 0) return "–";
  if (s < 60) return "< 1 min";
  if (s >= 100 * 3600) return `${Math.round(s / 3600).toLocaleString()} h`;
  return formatDuration(s);
}

/** Achsenschritt in Stunden: höchstens vier Linien, „runde“ Werte. */
function axisStep(maxSecs: number): number {
  const h = maxSecs / 3600;
  for (const step of [0.25, 0.5, 1, 2, 3, 5, 10, 20, 25, 50, 100, 200]) if (h / step <= 4) return step;
  return Math.ceil(h / 4 / 100) * 100;
}

export function StatsPage() {
  const t = useT();
  const nav = useNavigate();
  const lang = useLang((s) => s.lang);
  const loc = lang === "en" ? "en-US" : "de-DE";
  const [range, setRange] = useState<Range>("week");
  const { start, edges } = useMemo(() => buckets(range), [range]);
  const q = useQuery({ queryKey: ["playtime", range, start], queryFn: () => api.playtimeSessions(start), staleTime: 30_000 });
  const { data: instances = [] } = useInstances();
  const byId = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances]);

  const data = useMemo(() => {
    const list = q.data ?? [];
    const bars = edges.map((from, n) => {
      const to = edges[n + 1] ?? (range === "year" ? new Date(new Date(from).getFullYear(), new Date(from).getMonth() + 1, 1).getTime() : from + DAY);
      return { from, to, secs: sumIn(list, from, to) };
    });
    const perInst = new Map<string, { secs: number; sessions: number }>();
    for (const s of list) {
      const secs = Math.max(0, s.end - Math.max(s.start, start)) / 1000;
      const e = perInst.get(s.instance_id) ?? { secs: 0, sessions: 0 };
      e.secs += secs;
      e.sessions++;
      perInst.set(s.instance_id, e);
    }
    const rows = [...perInst.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.secs - a.secs);
    const total = bars.reduce((n, b) => n + b.secs, 0);
    const active = bars.filter((b) => b.secs >= 60).length;
    return { bars, rows, total, active, sessions: list.length };
  }, [q.data, edges, range, start]);

  // Y-Achse: runde Schritte (15 min … 100 h), oberste Linie = Skala
  const max = Math.max(1, ...data.bars.map((b) => b.secs));
  const step = axisStep(max);
  const ticks = Array.from({ length: Math.max(1, Math.ceil(max / 3600 / step)) + 1 }, (_, n) => n * step);
  const top = ticks[ticks.length - 1] * 3600;
  const tick = (h: number) => (h === 0 ? "0" : h < 1 ? `${Math.round(h * 60)} min` : `${h.toLocaleString(loc, { maximumFractionDigits: 2 })} h`);
  const label = (from: number) =>
    range === "year"
      ? new Date(from).toLocaleDateString(loc, { month: "short" })
      : range === "week"
        ? new Date(from).toLocaleDateString(loc, { weekday: "short" })
        : new Date(from).getDate().toString();
  const tip = (b: { from: number; secs: number }) =>
    `${new Date(b.from).toLocaleDateString(loc, range === "year" ? { month: "long", year: "numeric" } : { weekday: "long", day: "numeric", month: "long" })}: ${b.secs >= 60 ? formatDuration(b.secs) : t("stats.not_played")}`;
  // Genauer Zeitraum als Einordnung neben der Auswahl („13.–19. Nov.“)
  const period = useMemo(() => {
    const last = edges[edges.length - 1];
    const end = range === "year" ? Date.now() : last;
    try {
      return new Intl.DateTimeFormat(loc, range === "year" ? { month: "short", year: "numeric" } : { day: "numeric", month: "short" }).formatRange(
        new Date(start),
        new Date(end),
      );
    } catch {
      return "";
    }
  }, [edges, range, start, loc]);

  const top1 = data.rows[0];
  const topInst = top1 ? byId.get(top1.id) : undefined;
  const open = (id: string) => byId.has(id) && nav({ to: "/instances/$id", params: { id }, search: { tab: "content" } });
  const loading = !q.data && !q.isError;
  const empty = !!q.data && data.total < 60;

  return (
    <div className="scroll h-full">
      <div className={cn(pageWrap, "flex flex-col gap-4 pb-10 pt-4")}>
        {/* Werkzeugleiste: Zeitraum links, der genaue Zeitraum als Einordnung rechts */}
        <div className="flex h-8 items-center gap-3">
          <Segmented<Range>
            value={range}
            onChange={setRange}
            items={[
              { value: "week", label: t("stats.range.week") },
              { value: "month", label: t("stats.range.month") },
              { value: "year", label: t("stats.range.year") },
            ]}
          />
          <div className="flex-1" />
          {period && <span className="text-meta tabular-nums text-dim">{period}</span>}
        </div>

        {q.isError ? (
          <div className="rounded-panel bg-surface">
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-4" aria-busy>
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((n) => (
                <Skeleton key={n} className="h-[100px] rounded-panel" />
              ))}
            </div>
            <Skeleton className="h-[300px] rounded-panel" />
            <Skeleton className="h-[160px] rounded-panel" />
          </div>
        ) : empty ? (
          <div className="rounded-panel bg-surface">
            <EmptyState
              icon={<BarChart3 size={32} />}
              title={t(`stats.empty.title.${range}`)}
              text={t("stats.empty.text")}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {range !== "year" && (
                    <Button size="sm" onClick={() => setRange("year")}>
                      {t("stats.empty.show_year")}
                    </Button>
                  )}
                  <Button size="sm" variant="subtle" onClick={() => nav({ to: "/instances" })}>
                    {t("stats.empty.library")}
                  </Button>
                </div>
              }
            />
          </div>
        ) : (
          <>
            {/* Kennzahlen: Wert groß, darunter eine Zeile Einordnung */}
            <div className="grid grid-cols-3 gap-2">
              <Kpi
                label={t("stats.total")}
                value={duration(data.total)}
                sub={t(range === "year" ? "stats.total_sub_months" : "stats.total_sub_days", { n: data.active, of: data.bars.length })}
              />
              <Kpi
                label={t("stats.sessions")}
                value={data.sessions.toLocaleString(loc)}
                sub={data.sessions ? t("stats.avg", { time: duration(data.total / data.sessions) }) : null}
              />
              <Kpi
                label={t("stats.top")}
                small
                value={
                  top1 ? (
                    <span className="flex min-w-0 items-center gap-2.5">
                      <InstanceIcon icon={topInst?.icon} seed={top1.id} accent={instanceAccent(top1.id, topInst?.accent ?? null)} size={24} />
                      <span className="truncate">{topInst?.name ?? t("stats.deleted")}</span>
                    </span>
                  ) : (
                    "–"
                  )
                }
                sub={top1 ? t("stats.top_sub", { time: duration(top1.secs), pct: Math.round((top1.secs / (data.total || 1)) * 100) }) : null}
              />
            </div>

            <section className="rounded-panel bg-surface px-5 pb-4 pt-4">
              <h2 className="mb-5 text-section text-text">{t(range === "year" ? "stats.chart.per_month" : "stats.chart.per_day")}</h2>
              <div className="flex gap-3">
                <div className="relative h-[200px] w-12 shrink-0 text-right text-caption tabular-nums text-dim">
                  {ticks.map((h) => (
                    <span key={h} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: `${(h * 3600 * 100) / top}%` }}>
                      {tick(h)}
                    </span>
                  ))}
                </div>
                <div className="relative flex h-[200px] flex-1 items-end gap-1 border-b border-line2">
                  {ticks.slice(1).map((h) => (
                    <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${(h * 3600 * 100) / top}%` }} />
                  ))}
                  {data.bars.map((b, n) => (
                    <Tooltip key={b.from} content={tip(b)}>
                      <div className="group relative flex h-full flex-1 items-end justify-center">
                        <div className="absolute inset-0 rounded-xs group-hover:bg-white/[.03]" />
                        <div
                          className={cn(
                            "relative w-full max-w-[44px] rounded-t-xs bg-brand transition-[height,filter] duration-150 group-hover:brightness-110",
                            // Heute bzw. dieser Monat: volle Farbe, Vergangenes minimal ruhiger
                            n === data.bars.length - 1 ? "opacity-100" : "opacity-90",
                          )}
                          style={{ height: `${(b.secs / top) * 100}%`, minHeight: b.secs >= 60 ? 2 : 0 }}
                        />
                      </div>
                    </Tooltip>
                  ))}
                </div>
              </div>
              <div className="ml-[60px] mt-2 flex gap-1 text-center text-caption text-dim">
                {data.bars.map((b, n) => {
                  const current = n === data.bars.length - 1;
                  return (
                    <span key={b.from} className={cn("flex-1 truncate", current && "font-semibold text-text")}>
                      {range !== "month" || n % 3 === 0 || current ? label(b.from) : ""}
                    </span>
                  );
                })}
              </div>
            </section>

            <section className="overflow-hidden rounded-panel bg-surface">
              <h2 className="px-5 pb-1.5 pt-4 text-section text-text">{t("stats.per_instance")}</h2>
              <div className="pb-1.5">
                {data.rows.map((r) => {
                  const inst = byId.get(r.id);
                  const accent = instanceAccent(r.id, inst?.accent ?? null);
                  const pct = Math.round((r.secs / (data.total || 1)) * 100);
                  return (
                    <button
                      key={r.id}
                      disabled={!inst}
                      onClick={() => open(r.id)}
                      title={inst ? t("stats.open") : undefined}
                      className="group flex h-12 w-full min-w-0 items-center gap-4 px-5 text-left text-[13px] transition-colors duration-100 enabled:hover:bg-white/[.03] disabled:pointer-events-auto disabled:cursor-default"
                    >
                      <span className="flex w-[220px] min-w-0 shrink-0 items-center gap-2.5 max-[1100px]:w-[180px]">
                        <InstanceIcon icon={inst?.icon} seed={r.id} accent={accent} size={28} />
                        <span className={cn("truncate font-semibold", inst ? "text-text" : "text-dim")}>{inst?.name ?? t("stats.deleted")}</span>
                      </span>
                      <span className="h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-pill bg-white/[.06]">
                        <span className="block h-full rounded-pill" style={{ width: `${(r.secs / (data.rows[0].secs || 1)) * 100}%`, background: accent }} />
                      </span>
                      <span className="w-[96px] shrink-0 text-right font-semibold tabular-nums text-text">{duration(r.secs)}</span>
                      <span className="w-[44px] shrink-0 text-right tabular-nums text-muted">{pct} %</span>
                      <span className="w-[104px] shrink-0 whitespace-nowrap text-right tabular-nums text-dim max-[1100px]:hidden">
                        {t(r.sessions === 1 ? "stats.one_session" : "stats.n_sessions", { n: r.sessions.toLocaleString(loc) })}
                      </span>
                      <ChevronRight size={15} className={cn("-mr-1 shrink-0 text-dim transition-colors duration-100 group-hover:text-text", !inst && "invisible")} />
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/** Kennzahl-Kachel: Bezeichnung, großer Wert, eine Zeile Einordnung. */
function Kpi({ label, value, sub, small }: { label: string; value: ReactNode; sub?: ReactNode; small?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col rounded-panel bg-surface px-5 py-4">
      <div className="text-meta text-muted">{label}</div>
      <div
        className={cn(
          "mt-1.5 flex min-h-[30px] min-w-0 items-center truncate font-bold leading-tight tracking-[-0.01em] tabular-nums text-text",
          // Namen (Meistgespielt) etwas kleiner als Zahlen, damit sie nicht dominieren und seltener abgeschnitten werden
          small ? "text-[17px]" : "text-[22px]",
        )}
      >
        {value}
      </div>
      <div className="mt-1 min-h-[17px] truncate text-meta text-dim">{sub}</div>
    </div>
  );
}
