import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/i18n";
import { FeedbackButton } from "@/features/feedback/FeedbackButtons";
import { HelpButton } from "@/features/help/HelpButton";
import { FriendsPanelToggle } from "@/features/social/FriendsPanelToggle";
import { TaskDock } from "../TaskDock";
import { UpdateButton } from "../UpdateNotice";
import { AccountMenu } from "../AccountMenu";
import { WindowControls } from "../WindowControls";
import { goBack, goForward } from "../backNav";
import { RunningGames, usePageTitle } from "../nav";

export function TopbarV2() {
  const t = useT();
  const title = usePageTitle();
  const navBtn = "grid h-8 w-8 place-items-center rounded-ctl text-muted transition-colors duration-150 hover:bg-[var(--v2-hover)] hover:text-text";
  return (
    <header data-tauri-drag-region className="vl2-topbar flex h-[var(--titlebar-h)] shrink-0 items-center gap-2 bg-bg pl-1">
      <div className="flex items-center gap-0.5">
        <button aria-label={t("common.back")} className={navBtn} onClick={goBack}>
          <ChevronLeft size={18} />
        </button>
        <button aria-label={t("rail.forward")} className={navBtn} onClick={goForward}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold tracking-[-0.01em] text-text">
        {title}
      </div>
      <div data-tauri-drag-region className="h-full min-w-4 flex-1" />
      <UpdateButton />
      <RunningGames />
      <div className="vl2-tools flex h-9 shrink-0 items-center gap-0.5 rounded-ctl bg-surface px-0.5 shadow-[inset_0_0_0_1px_var(--line-1)]">
        <TaskDock />
        <HelpButton />
        <FeedbackButton />
        <FriendsPanelToggle />
      </div>
      <AccountMenu />
      <WindowControls />
    </header>
  );
}
