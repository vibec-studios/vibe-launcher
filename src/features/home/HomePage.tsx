// Startseite. Was will man beim Öffnen? Meist genau dort weiterspielen, wo man aufgehört hat – also steht oben
// „Weiterspielen“ (letzte Instanz + letzte Welt/Server, beides mit einem Klick). Darunter die übrigen zuletzt
// gespielten Instanzen und Welten/Server zum direkten Starten. Rechts das, was sich seit dem letzten Mal getan hat:
// Freunde online/hostend (nur mit Vibe), Updates für die eigenen Instanzen. Unten Anregungen (beliebte Modpacks).
// Ohne Instanz: drei klare Einstiege statt einer leeren Seite.
import { Link } from "@tanstack/react-router";
import { PackageOpen, Plus } from "lucide-react";
import { Button, Skeleton, cn, pageWrap } from "@/components/ui";
import { openNewInstance } from "@/components/instance/actions";
import { openImport } from "@/features/import/importStore";
import { useVibe } from "@/lib/vibe";
import { useT } from "@/i18n";
import { useGreeting, useHomeData } from "./useHomeData";
import { HomeV2 } from "./v2/HomeV2";
import { useLiveAppearance } from "@/lib/appearance";
import { ContinueCard } from "./Continue";
import { JumpBackIn, RecentInstances } from "./Recent";
import { FriendsBlock, VibeNews } from "./Side";
import { HomeAside } from "./Aside";
import { sideWidth, useHeight, useTier } from "./layout";
import { PopularPacks, StartHere } from "./Discover";
import { StarterCard } from "./StarterCard";

function Header({ count, loading }: { count: number; loading?: boolean }) {
  const t = useT();
  const g = useGreeting(count);
  // Beim Start nicht erst „Willkommen“ und dann „Willkommen zurück, Name“ zeigen
  if (loading || g.pending)
    return (
      <header className="flex min-h-[44px] flex-col justify-end gap-1.5" aria-busy>
        <Skeleton className="h-[22px] w-72" />
        <Skeleton className="h-3.5 w-48" />
      </header>
    );
  return (
    <header className="flex min-w-0 items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-title text-text">{g.title}</h1>
        {count > 0 && (
          <p className="mt-0.5 truncate text-meta text-muted">
            {g.summary}
            {" · "}
            <Link to="/stats" className="underline decoration-line2 underline-offset-2 transition-colors duration-100 hover:text-text">
              {g.week}
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
  const v2 = useLiveAppearance((s) => s.a.design === "v2");
  return v2 ? <HomeV2 /> : <ExpertHome />;
}

function ExpertHome() {
  const vibe = useVibe();
  const [ref, tier] = useTier<HTMLDivElement>();
  const [leftRef, leftHeight] = useHeight<HTMLDivElement>();
  const { list, hero, heroSpot, others, restSpots, spotsLoading, loading, empty } = useHomeData();

  return (
    <div className="scroll h-full">
      <div ref={ref} className={cn(pageWrap, "flex flex-col gap-6 pb-10 pt-6")}>
        <Header count={list.length} loading={loading} />
        {!loading && <StarterCard />}

        {loading ? (
          // Platzhalter in der Form der echten Seite (Weiterspielen, Zuletzt gespielt, Welten/Server | rechte Spalte)
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-6" aria-busy>
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
            <div className={cn("flex flex-col gap-6", sideWidth[tier])}>
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
              <aside className={cn("flex flex-col gap-6 empty:hidden", sideWidth[tier])}>
                <VibeNews />
                <FriendsBlock />
              </aside>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-6">
              <div ref={leftRef} className="flex min-w-0 flex-col gap-6">
                <ContinueCard key={hero.id} instance={hero} spot={heroSpot} />
                <RecentInstances list={others} total={list.length} />
                <JumpBackIn spots={restSpots} loading={spotsLoading} />
              </div>
              <HomeAside tier={tier} instances={list} left={leftHeight} />
            </div>
            <PopularPacks />
          </>
        )}
      </div>
    </div>
  );
}
