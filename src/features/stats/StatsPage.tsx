// OWNER: Frontend-Agent A. Spielzeit-Statistik: Woche/Monat/Jahr, Balken je Tag bzw. Monat, Aufteilung je Instanz.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { api } from "@/lib/api";
import { useInstances } from "@/lib/queries";
import type { PlaySession } from "@/lib/types";
import { formatDuration, instanceAccent } from "@/lib/format";
import { EmptyState, ErrorState, Segmented, Skeleton, Tooltip } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { useLang, useT } from "@/i18n";

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

export function sumIn(sessions: PlaySession[], from: number, to = Infinity): number {
  let ms = 0;
  for (const s of sessions) ms += Math.max(0, Math.min(s.end, to) - Math.max(s.start, from));
  return ms / 1000;
}

/** Spielzeit der laufenden Woche (ab Montag) in Sekunden – für die Startseite. */
export function useWeekPlaytime() {
  const monday = (() => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
  })();
  return useQuery({
    queryKey: ["playtime", "week", monday],
    queryFn: () => api.playtimeSessions(monday),
    select: (l) => sumIn(l, monday),
    staleTime: 60_000,
  });
}

export function StatsPage() {
  const t = useT();
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
      return { from, secs: sumIn(list, from, to) };
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
    return { bars, rows, total, sessions: list.length };
  }, [q.data, edges, range, start]);

  const max = Math.max(1, ...data.bars.map((b) => b.secs));
  // Achse in ganzen Stunden (mind. 1 h)
  const axisH = Math.max(1, Math.ceil(max / 3600));
  const label = (from: number) =>
    range === "year"
      ? new Date(from).toLocaleDateString(loc, { month: "short" })
      : range === "week"
        ? new Date(from).toLocaleDateString(loc, { weekday: "short" })
        : new Date(from).getDate().toString();
  const fmt = (s: number) => (s >= 60 ? formatDuration(s) : s > 0 ? "< 1 min" : "–");
  const top = data.rows[0];

  return (
    <div className="scroll h-full">
      <div className="flex flex-col gap-3 px-6 pb-10 pt-4">
        <div className="flex h-8 items-center gap-2">
          <Segmented<Range>
            value={range}
            onChange={setRange}
            items={[
              { value: "week", label: t("stats.week") },
              { value: "month", label: t("stats.month") },
              { value: "year", label: t("stats.year") },
            ]}
          />
        </div>

        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <>
            <Skeleton className="h-[72px] rounded-card" />
            <Skeleton className="h-[240px] rounded-card" />
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                [t("stats.total"), fmt(data.total)],
                [t("stats.sessions"), data.sessions.toString()],
                [t("stats.top"), top ? (byId.get(top.id)?.name ?? top.id) : "–"],
              ].map(([k, v], n) => (
                <div key={k} className="min-w-0 rounded-card bg-surface px-4 py-3">
                  <div className="text-meta text-muted">{k}</div>
                  <div className={n === 2 ? "truncate text-title text-text" : "truncate text-title tabular-nums text-text"}>{v}</div>
                </div>
              ))}
            </div>

            <section className="rounded-card bg-surface p-4">
              <div className="mb-3 text-section text-text">{t(`stats.chart.${range}`)}</div>
              <div className="flex gap-3">
                <div className="flex h-[200px] w-10 flex-col justify-between text-right text-[11px] tabular-nums text-dim">
                  <span>{axisH} h</span>
                  <span>{axisH / 2} h</span>
                  <span>0</span>
                </div>
                <div className="relative flex h-[200px] flex-1 items-end gap-[2px] border-b border-line">
                  <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
                  {data.bars.map((b) => (
                    <Tooltip
                      key={b.from}
                      content={`${new Date(b.from).toLocaleDateString(loc, range === "year" ? { month: "long", year: "numeric" } : { weekday: "short", day: "numeric", month: "short" })}: ${fmt(b.secs)}`}
                    >
                      <div className="group relative flex h-full flex-1 items-end">
                        <div className="absolute inset-0 group-hover:bg-white/[.03]" />
                        <div
                          className="relative w-full rounded-t-xs bg-brand transition-[height,opacity] duration-150 group-hover:opacity-80"
                          style={{ height: `${(b.secs / (axisH * 3600)) * 100}%`, minHeight: b.secs > 0 ? 2 : 0 }}
                        />
                      </div>
                    </Tooltip>
                  ))}
                </div>
              </div>
              <div className="ml-[52px] mt-1.5 flex gap-[2px] text-center text-[11px] text-dim">
                {data.bars.map((b, n) => (
                  <span key={b.from} className="flex-1 truncate">
                    {range !== "month" || n % 3 === 0 || n === data.bars.length - 1 ? label(b.from) : ""}
                  </span>
                ))}
              </div>
            </section>

            <section className="rounded-card bg-surface">
              <div className="px-4 pb-1 pt-3 text-section text-text">{t("stats.per_instance")}</div>
              {data.rows.length === 0 ? (
                <EmptyState icon={<BarChart3 size={28} />} title={t("stats.empty.title")} text={t("stats.empty.text")} className="py-10" />
              ) : (
                <table className="w-full text-[13px]">
                  <tbody>
                    {data.rows.map((r) => {
                      const inst = byId.get(r.id);
                      const accent = instanceAccent(r.id, inst?.accent ?? null);
                      return (
                        <tr key={r.id} className="border-t border-line first:border-t-0">
                          <td className="w-[260px] px-4 py-2">
                            <div className="flex items-center gap-2.5">
                              <InstanceIcon icon={inst?.icon} accent={accent} size={28} />
                              <span className="truncate font-medium text-text">{inst?.name ?? r.id}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="h-1.5 overflow-hidden rounded-pill bg-white/[.06]">
                              <div className="h-full rounded-pill" style={{ width: `${(r.secs / (data.rows[0].secs || 1)) * 100}%`, background: accent }} />
                            </div>
                          </td>
                          <td className="w-[110px] px-2 py-2 text-right tabular-nums text-text">{fmt(r.secs)}</td>
                          <td className="w-[110px] px-4 py-2 text-right tabular-nums text-muted">
                            {t(r.sessions === 1 ? "stats.one_session" : "stats.n_sessions", { n: r.sessions })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
