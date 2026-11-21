import { Check, Sparkles, X } from "lucide-react";
import { Skeleton, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { Cape } from "@/lib/types";
import { McCapeThumb } from "../McCapesPanel";
import { useCapeFront } from "../render";
import type { McCapeFrames, McProfile } from "../minecraftcapes";

/** MinecraftCapes-Kachel in der Cape-Leiste (klar getrennt von den offiziellen Capes). */
export function McTile({ profile, frames, selected, onClick }: { profile: McProfile; frames: McCapeFrames | null; selected: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <Tooltip content={`${t("mccapes.title")} · ${t("mccapes.show_in_preview")}`}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          "relative grid h-[76px] w-[58px] place-items-center rounded-ctl transition-colors duration-150",
          selected ? "bg-surface3 outline outline-2 outline-accent" : "bg-surface2 hover:bg-surface3",
        )}
      >
        {profile.cape ? <McCapeThumb frames={frames} scale={4} /> : <Sparkles size={18} className="text-dim" />}
        {profile.cape && profile.glint && (
          <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-pill bg-[#7b4dff] text-text">
            <Sparkles size={10} strokeWidth={2.5} />
          </span>
        )}
      </button>
    </Tooltip>
  );
}

export function CapeTile({ cape, label, selected, active, onClick }: { cape?: Cape; label: string; selected: boolean; active: boolean; onClick: () => void }) {
  const t = useT();
  const img = useCapeFront(cape?.data_url ?? null, 4);
  return (
    <Tooltip content={active ? `${label} · ${t("skins.cape_active")}` : label}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          "relative grid h-[76px] w-[58px] place-items-center rounded-ctl transition-colors duration-150",
          selected ? "bg-surface3 outline outline-2 outline-accent" : "bg-surface2 hover:bg-surface3",
        )}
      >
        {cape ? (
          img ? (
            <img src={img} alt={label} className="h-[64px] w-[40px] [image-rendering:pixelated]" draggable={false} />
          ) : (
            <Skeleton className="h-[64px] w-[40px]" />
          )
        ) : (
          <X size={18} className="text-dim" />
        )}
        {active && (
          <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-pill bg-accent text-[var(--on-accent)]">
            <Check size={10} strokeWidth={3} />
          </span>
        )}
      </button>
    </Tooltip>
  );
}
