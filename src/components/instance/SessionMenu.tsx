import { ChevronDown, CopyPlus, Square, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { isActive } from "@/lib/sessions";
import type { GameState, Instance } from "@/lib/types";
import { killInstance, openConsole, useInstanceActions } from "./actions";
import { AfkSessionItems } from "@/features/afk/AfkMenu";

export function SessionMenuItems({ instance, runs }: { instance: Instance; runs: GameState[] }) {
  const t = useT();
  const { launchAgain } = useInstanceActions();
  const active = runs.filter(isActive);
  const newest = active[active.length - 1];
  return (
    <>
      {!instance.bedrock && (
        <DropdownItem icon={<CopyPlus size={14} />} onSelect={() => launchAgain(instance)}>
          {t("sess.again")}
        </DropdownItem>
      )}
      <DropdownItem icon={<SquareTerminal size={14} />} onSelect={() => openConsole(newest?.run_id)}>
        {t("sess.console")}
      </DropdownItem>
      {active.length > 1 && (
        <>
          <DropdownSeparator />
          <DropdownLabel>{t("sess.running_title")}</DropdownLabel>
          {active.map((r) => (
            <DropdownItem key={r.run_id} danger icon={r.state === "preparing" ? <Spinner size={11} /> : <Square size={11} fill="currentColor" />} onSelect={() => killInstance(instance, r.run_id)}>
              {t("sess.stop_one", { n: r.slot })}
              {r.account_name ? <span className="text-dim"> · {r.account_name}</span> : null}
              {r.resumed ? <span className="text-dim"> · {t(r.resumed === "external" ? "sess.resumed_external" : "sess.resumed")}</span> : null}
            </DropdownItem>
          ))}
        </>
      )}
      <AfkSessionItems instance={instance} runs={runs} />
    </>
  );
}

export function SessionMenuTrigger({
  instance,
  runs,
  className,
  compact,
  children,
}: {
  instance: Instance;
  runs: GameState[];
  className?: string;
  compact?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  const preparing = runs.some((r) => r.state === "preparing");
  return (
    <DropdownMenu
      align="end"
      trigger={
        <button
          aria-label={t("sess.more")}
          title={t("sess.again")}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn("grid shrink-0 place-items-center transition-colors duration-100", compact ? "w-5" : "w-9", className)}
        >
          {children ?? (preparing ? <Spinner size={12} /> : <ChevronDown size={compact ? 12 : 15} />)}
        </button>
      }
    >
      <SessionMenuItems instance={instance} runs={runs} />
    </DropdownMenu>
  );
}
