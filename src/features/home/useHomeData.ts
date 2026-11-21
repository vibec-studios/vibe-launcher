import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEvent } from "@/lib/events";
import { useAccounts, useInstances } from "@/lib/queries";
import { formatDuration } from "@/lib/format";
import { useWeekPlaytime } from "@/features/stats/StatsPage";
import { useT } from "@/i18n";
import { byRecent, useSpots } from "./data";

const RECENT = 8;
const SPOTS = 8;

/** Gemeinsame Daten der Startseite (v1 und v2): Instanzen nach „zuletzt gespielt“, Weiterspielen-Instanz mit
 *  ihrem letzten Einstieg, weitere Instanzen und Einstiege. Lädt nach dem Spielen Wochenzeit, Server und Welten neu. */
export function useHomeData() {
  const { data, isLoading } = useInstances();
  const list = useMemo(() => byRecent(data ?? []), [data]);
  const hero = list[0];
  const { spots, loading: spotsLoading } = useSpots(list);
  const heroSpot = hero ? (spots.find((s) => s.instance.id === hero.id) ?? null) : null;
  const others = useMemo(() => list.slice(1, 1 + RECENT), [list]);
  const restSpots = useMemo(() => spots.filter((s) => s !== heroSpot).slice(0, SPOTS), [spots, heroSpot]);

  const qc = useQueryClient();
  useEvent("game://state", (s) => {
    if (s.state === "stopped") {
      qc.invalidateQueries({ queryKey: ["playtime"] });
      qc.invalidateQueries({ queryKey: ["servers-recent"] });
      qc.invalidateQueries({ queryKey: ["worlds", s.instance_id] });
    }
  });

  const loading = isLoading && !data;
  return { list, hero, heroSpot, others, restSpots, spotsLoading, loading, empty: !loading && !hero };
}

/** Begrüßung oben auf der Startseite: Titel, Zusammenfassung und Spielzeit dieser Woche. */
export function useGreeting(count: number) {
  const t = useT();
  const { data: accounts = [], isPending } = useAccounts();
  const active = accounts.find((a) => a.active) ?? accounts[0];
  const week = useWeekPlaytime();
  const title =
    count > 0
      ? active
        ? t("home.welcome_name", { name: active.username })
        : t("home.welcome")
      : active
        ? t("home.hello_name", { name: active.username })
        : t("home.hello");
  return {
    pending: isPending && !accounts.length,
    title,
    summary: count === 1 ? t("home.summary_one") : t("home.summary", { n: count }),
    week: t("home.week", { time: week.data && week.data >= 60 ? formatDuration(week.data) : "0 min" }),
  };
}
