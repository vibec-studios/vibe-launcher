// Startseite. Was will man beim Öffnen? Meist genau dort weiterspielen, wo man aufgehört hat – also steht oben
// „Weiterspielen“ (letzte Instanz + letzte Welt/Server, beides mit einem Klick). Darunter die übrigen zuletzt
// gespielten Instanzen und Welten/Server zum direkten Starten. Rechts das, was sich seit dem letzten Mal getan hat:
// Freunde online/hostend (nur mit Vibe), Updates für die eigenen Instanzen. Unten Anregungen (beliebte Modpacks).
// Ohne Instanz: drei klare Einstiege statt einer leeren Seite.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { PackageOpen, Plus } from "lucide-react";
import { useEvent } from "@/lib/events";
import { useAccounts, useInstances } from "@/lib/queries";
import { formatDuration } from "@/lib/format";
import { Button, Skeleton } from "@/components/ui";
import { openNewInstance } from "@/components/instance/actions";
import { openImport } from "@/features/import/ImportDialog";
import { useWeekPlaytime } from "@/features/stats/StatsPage";
import { useVibe } from "@/lib/vibe";
import { useT } from "@/i18n";
import { byRecent, useSpots } from "./data";
import { ContinueCard } from "./Continue";
import { JumpBackIn, RecentInstances } from "./Recent";
import { FriendsBlock, UpdatesBlock, VibeNews } from "./Side";
import { PopularPacks, StartHere } from "./Discover";
import { SimpleHome } from "./SimpleHome";
import { useSimple } from "@/lib/mode";

const RECENT = 6;
const SPOTS = 5;

function Header({ count, loading }: { count: number; loading?: boolean }) {
  const t = useT();
  const { data: accounts = [], isPending } = useAccounts();
  const active = accounts.find((a) => a.active) ?? accounts[0];
  const week = useWeekPlaytime();
  // Beim Start nicht erst „Willkommen“ und dann „Willkommen zurück, Name“ zeigen
  if (loading || (isPending && !accounts.length))
    return (
      <header className="flex min-h-[44px] flex-col justify-end gap-1.5" aria-busy>
        <Skeleton className="h-[22px] w-72" />
        <Skeleton className="h-3.5 w-48" />
      </header>
    );
  return (
    <header className="flex min-w-0 items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-title text-text">
          {count > 0
            ? active
              ? t("home.welcome_name", { name: active.username })
              : t("home.welcome")
            : active
              ? t("home.hello_name", { name: active.username })
              : t("home.hello")}
        </h1>
        {count > 0 && (
          <p className="mt-0.5 truncate text-meta text-muted">
            {count === 1 ? t("home.summary_one") : t("home.summary", { n: count })}
            {" · "}
            <Link to="/stats" className="underline decoration-line2 underline-offset-2 transition-colors duration-100 hover:text-text">
              {t("home.week", { time: week.data && week.data >= 60 ? formatDuration(week.data) : "0 min" })}
            </Link>
          </p>
        )}
      </div>
      {count > 0 && (
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="subtle" icon={<PackageOpen size={14} />} onClick={() => openImport()}>
            {t("home.action.import")}
          </Button>
          <Button size="sm" icon={<Plus size={15} />} onClick={openNewInstance}>
            {t("inst.new")}
          </Button>
        </div>
      )}
    </header>
  );
}

export function HomePage() {
  // Simple-Modus: eigene, ruhige Startseite (großer Spielen-Knopf + „Neues Spiel“-Kacheln)
  return useSimple() ? <SimpleHome /> : <ExpertHome />;
}

function ExpertHome() {
  const { data, isLoading } = useInstances();
  const vibe = useVibe();
  const list = useMemo(() => byRecent(data ?? []), [data]);
  const hero = list[0];
  const { spots, loading: spotsLoading } = useSpots(list);

  // Letzter Einstieg der Hero-Instanz (zuletzt gespielte Welt oder zuletzt besuchter Server)
  const heroSpot = hero ? (spots.find((s) => s.instance.id === hero.id) ?? null) : null;
  const others = useMemo(() => list.slice(1, 1 + RECENT), [list]);
  const restSpots = useMemo(() => spots.filter((s) => s !== heroSpot).slice(0, SPOTS), [spots, heroSpot]);

  // Nach dem Spielen: Wochenzeit, Server und Welten neu laden
  const qc = useQueryClient();
  useEvent("game://state", (s) => {
    if (s.state === "stopped") {
      qc.invalidateQueries({ queryKey: ["playtime"] });
      qc.invalidateQueries({ queryKey: ["servers-recent"] });
      qc.invalidateQueries({ queryKey: ["worlds", s.instance_id] });
    }
  });

  const loading = isLoading && !data;
  const empty = !loading && !hero;

  return (
    <div className="scroll h-full">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-6 pb-10 pt-6">
        <Header count={list.length} loading={loading} />

        {loading ? (
          // Platzhalter in der Form der echten Seite (Weiterspielen, Zuletzt gespielt, Welten/Server | rechte Spalte)
          <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-6 max-[980px]:grid-cols-[minmax(0,1fr)_272px]" aria-busy>
            <div className="flex min-w-0 flex-col gap-6">
              <Skeleton className="h-[210px] rounded-panel" />
              <div className="flex flex-col gap-2.5">
                <Skeleton className="h-4 w-32" />
                <div className="grid grid-cols-3 gap-2">
                  <Skeleton className="h-[72px] rounded-panel" />
                  <Skeleton className="h-[72px] rounded-panel" />
                  <Skeleton className="h-[72px] rounded-panel" />
                </div>
              </div>
              <div className="flex flex-col gap-2.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-[168px] rounded-panel" />
              </div>
            </div>
            <div className="flex flex-col gap-6">
              <Skeleton className="h-[88px] rounded-panel" />
              <div className="flex flex-col gap-2.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-[220px] rounded-panel" />
              </div>
            </div>
          </div>
        ) : empty ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-6">
            <div className="flex min-w-0 flex-col gap-6">
              <StartHere />
              <PopularPacks rows={2} />
            </div>
            {vibe.enabled && (
              <aside className="flex w-[300px] flex-col gap-6 empty:hidden">
                <VibeNews />
                <FriendsBlock />
              </aside>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-6 max-[980px]:grid-cols-[minmax(0,1fr)_272px]">
              <div className="flex min-w-0 flex-col gap-6">
                <ContinueCard key={hero.id} instance={hero} spot={heroSpot} />
                <RecentInstances list={others} total={list.length} />
                <JumpBackIn spots={restSpots} loading={spotsLoading} />
              </div>
              <aside className="flex min-w-0 flex-col gap-6">
                <VibeNews />
                <FriendsBlock />
                <UpdatesBlock instances={list} />
              </aside>
            </div>
            <PopularPacks />
          </>
        )}
      </div>
    </div>
  );
}
