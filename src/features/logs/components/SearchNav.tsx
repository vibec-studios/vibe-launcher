import { ChevronDown, ChevronUp } from "lucide-react";
import { IconButton } from "@/components/ui";
import { useT } from "@/i18n";

export function SearchNav({ matches, curPos, go }: { matches: number[]; curPos: number; go: (dir: 1 | -1) => void }) {
  const t = useT();
  return (
    <>
      <span className="min-w-[52px] shrink-0 text-center font-mono text-[11px] text-dim">
        {matches.length ? `${curPos >= 0 ? curPos + 1 : "–"}/${matches.length.toLocaleString()}` : "0/0"}
      </span>
      <IconButton label={t("logs.prev")} variant="ghost" disabled={!matches.length} onClick={() => go(-1)}>
        <ChevronUp size={15} />
      </IconButton>
      <IconButton label={t("logs.next")} variant="ghost" disabled={!matches.length} onClick={() => go(1)}>
        <ChevronDown size={15} />
      </IconButton>
    </>
  );
}
