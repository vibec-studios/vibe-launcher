import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/i18n";
import { TaskDock } from "./TaskDock";
import { UpdateButton } from "./UpdateNotice";
import { AccountMenu } from "./AccountMenu";
import { FriendsPanelToggle } from "@/features/social/FriendsPanelToggle";
import { goBack, goForward } from "./backNav";
import { RunningGames, usePageTitle } from "./nav";
import { WindowControls } from "./WindowControls";
import { FeedbackButton } from "@/features/feedback/FeedbackButtons";
import { HelpButton } from "@/features/help/HelpButton";

// ------------------------------------------------------------------ Topbar

export function Topbar() {
  const t = useT();
  const title = usePageTitle();
  const navBtn = "grid h-7 w-7 place-items-center rounded-ctl text-dim transition-colors duration-100 hover:bg-white/[.06] hover:text-text";
  return (
    <header data-tauri-drag-region className="flex h-[var(--titlebar-h)] shrink-0 items-center bg-bg pl-2">
      <div className="flex items-center gap-0.5">
        <button aria-label={t("common.back")} className={navBtn} onClick={goBack}>
          <ChevronLeft size={18} />
        </button>
        <button aria-label={t("rail.forward")} className={navBtn} onClick={goForward}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div data-tauri-drag-region className="ml-2 flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-text">
        {title}
      </div>
      <div data-tauri-drag-region className="h-full flex-1" />
      <div className="flex items-center gap-1.5 pr-3">
        <UpdateButton />
        <TaskDock />
        <HelpButton />
        <FeedbackButton />
        <FriendsPanelToggle />
        <span className="mx-0.5 h-5 w-px bg-line2" aria-hidden />
        <RunningGames />
        <AccountMenu />
      </div>
      <WindowControls />
    </header>
  );
}
