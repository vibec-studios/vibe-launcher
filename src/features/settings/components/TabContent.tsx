import { Skeleton } from "@/components/ui";
import { AppearanceTab } from "../AppearanceTab";
import { PrivacyTab } from "@/features/privacy/PrivacyTab";
import { VibeTab } from "../VibeCard";
import type { SettingsTab } from "../store";
import type { TabProps } from "../types";
import { AboutTab } from "../tabs/AboutTab";
import { DownloadsTab } from "../tabs/DownloadsTab";
import { GameTab } from "../tabs/GameTab";
import { GeneralTab } from "../tabs/GeneralTab";
import { JavaTab } from "../tabs/JavaTab";
import { StorageTabHost } from "../tabs/StorageTabHost";
import { UpdatesTab } from "../tabs/UpdatesTab";

export function TabContent({ tab, s, update }: TabProps & { tab: SettingsTab }) {
  switch (tab) {
    case "general":
      return <GeneralTab s={s} update={update} />;
    case "appearance":
      return <AppearanceTab s={s} update={update} />;
    case "java":
      return <JavaTab s={s} update={update} />;
    case "game":
      return <GameTab s={s} update={update} />;
    case "downloads":
      return <DownloadsTab s={s} update={update} />;
    case "storage":
      return <StorageTabHost />;
    case "vibe":
      return <VibeTab settings={s} update={update} />;
    case "privacy":
      return <PrivacyTab s={s} update={update} />;
    case "updates":
      return <UpdatesTab s={s} update={update} />;
    case "about":
      return <AboutTab />;
  }
}

export function LoadingCards() {
  return (
    <>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="mx-1 h-3 w-24" />
          <div className="rounded-card bg-surface">
          {Array.from({ length: 3 }, (_, j) => (
            <div key={j} className="flex items-center gap-6 px-4 py-3">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-72" />
              </div>
              <Skeleton className="h-8 w-32" />
            </div>
          ))}
          </div>
        </div>
      ))}
    </>
  );
}
