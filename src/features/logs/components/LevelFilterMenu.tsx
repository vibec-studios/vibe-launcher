import { ListFilter } from "lucide-react";
import { DropdownCheckItem, DropdownLabel, DropdownMenu, IconButton, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { CATS, type LevelCat } from "../logText";

export function LevelFilterMenu({ cats, counts, toggleCat }: { cats: LevelCat[]; counts: Record<LevelCat, number>; toggleCat: (c: LevelCat) => void }) {
  const t = useT();
  return (
    <DropdownMenu
      trigger={
        <IconButton label={t("logs.levels")} tip variant="ghost" badge={CATS.length - cats.length || null} badgeTone="muted" className="data-[state=open]:bg-white/[.07]">
          <ListFilter size={16} />
        </IconButton>
      }
    >
      <DropdownLabel>{t("logs.levels")}</DropdownLabel>
      {CATS.map((c) => (
        <DropdownCheckItem key={c} checked={cats.includes(c)} onCheckedChange={() => toggleCat(c)}>
          <span className="flex w-full items-center gap-2">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-dot",
                c === "info" ? "bg-text" : c === "warn" ? "bg-warn" : c === "error" ? "bg-danger" : c === "debug" ? "bg-dim" : "bg-accent",
              )}
            />
            <span className="flex-1">{t(`logs.level.${c}`)}</span>
            <span className="tabular-nums text-dim">{counts[c].toLocaleString()}</span>
          </span>
        </DropdownCheckItem>
      ))}
    </DropdownMenu>
  );
}
