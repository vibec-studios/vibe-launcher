import { Link } from "@tanstack/react-router";
import { Clock, Layers, PackageOpen, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Skeleton, cn, pageWrap } from "@/components/ui";
import { openNewInstance } from "@/components/instance/actions";
import { openImport } from "@/features/import/ImportDialog";
import { useVibe } from "@/lib/vibe";
import { useT } from "@/i18n";
import { useGreeting, useHomeData } from "../useHomeData";
import { JumpBackIn, RecentInstances } from "../Recent";
import { FriendsBlock, VibeNews } from "../Side";
import { HomeAside } from "../Aside";
import { sideWidth, useHeight, useTier } from "../layout";
import { PopularPacks, StartHere } from "../Discover";
import { HeroV2 } from "./HeroV2";
import { StarterCard } from "../StarterCard";

function Stat({ icon, children, to }: { icon: ReactNode; children: ReactNode; to?: "/stats" | "/instances" }) {
  const cls =
    "inline-flex h-7 items-center gap-1.5 rounded-pill bg-surface px-2.5 text-[12.5px] font-medium text-muted shadow-[inset_0_0_0_1px_var(--line-1)] transition-colors duration-150";
  if (!to)
    return (
      <span className={cls}>
        {icon}
        {children}
      </span>
    );
  return (
    <Link to={to} className={cn(cls, "hover:text-text")}>
      {icon}
      {children}
    </Link>
  );
}

function HeaderV2({ count, loading }: { count: number; loading: boolean }) {
  const t = useT();
  const g = useGreeting(count);
  if (loading || g.pending)
    return (
      <header className="flex min-h-[64px] flex-col justify-end gap-2" aria-busy>
        <Skeleton className="h-7 w-80" />
        <Skeleton className="h-6 w-56" />
      </header>
    );
  return (
    <header className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-hero text-text">{g.title}</h1>
        {count > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Stat icon={<Layers size={13} />} to="/instances">
              {g.summary}
            </Stat>
            <Stat icon={<Clock size={13} />} to="/stats">
              {g.week}
            </Stat>
          </div>
        )}
      </div>
      {count > 0 && (
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="subtle" icon={<PackageOpen size={15} />} onClick={() => openImport()}>
            {t("home.action.import")}
          </Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={openNewInstance}>
            {t("inst.new")}
          </Button>
        </div>
      )}
    </header>
  );
}

export function HomeV2() {
  const vibe = useVibe();
  const [ref, tier] = useTier<HTMLDivElement>();
  const [leftRef, leftHeight] = useHeight<HTMLDivElement>();
  const { list, hero, heroSpot, others, restSpots, spotsLoading, loading, empty } = useHomeData();

  return (
    <div className="scroll h-full">
      <div ref={ref} className={cn(pageWrap, "flex flex-col gap-8 pb-12 pt-7 min-[1600px]:px-9")}>
        <HeaderV2 count={list.length} loading={loading} />
        {!loading && <StarterCard />}
        {loading ? (
          <div className="flex flex-col gap-8" aria-busy>
            <Skeleton className="h-[248px] rounded-panel" />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-8">
              <div className="flex min-w-0 flex-col gap-3">
                <Skeleton className="h-4 w-32" />
                <div className="grid grid-cols-3 gap-2">
                  <Skeleton className="h-[72px] rounded-panel" />
                  <Skeleton className="h-[72px] rounded-panel" />
                  <Skeleton className="h-[72px] rounded-panel" />
                </div>
              </div>
              <Skeleton className={cn("h-[220px] rounded-panel", sideWidth[tier])} />
            </div>
          </div>
        ) : empty ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-8">
            <div className="flex min-w-0 flex-col gap-8">
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
            <HeroV2 key={hero.id} instance={hero} spot={heroSpot} />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-8">
              <div ref={leftRef} className="flex min-w-0 flex-col gap-8">
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
