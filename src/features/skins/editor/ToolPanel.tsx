import { Brush, Eraser, FlipHorizontal2, PaintBucket, Pipette } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { SkinEditor, Tool } from "./useSkinEditor";

const TOOLS: { id: Tool; icon: ReactNode }[] = [
  { id: "brush", icon: <Brush size={18} /> },
  { id: "eraser", icon: <Eraser size={18} /> },
  { id: "picker", icon: <Pipette size={18} /> },
  { id: "fill", icon: <PaintBucket size={18} /> },
];

function ToolButton({ active, onClick, icon, label, tip }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; tip: string }) {
  return (
    <Tooltip content={tip} side="right">
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          "flex h-10 w-full items-center gap-2.5 rounded-ctl px-3 text-[13.5px] font-semibold transition-colors duration-100",
          active ? "bg-brand text-[var(--ui-on-accent)]" : "bg-surface2 text-text hover:bg-surface3",
        )}
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
    </Tooltip>
  );
}

export function ToolPanel({ ed }: { ed: SkinEditor }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <div className="text-section text-muted">{t("skined.tools")}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {TOOLS.map((tool) => (
          <ToolButton
            key={tool.id}
            active={ed.tool === tool.id}
            onClick={() => ed.setTool(tool.id)}
            icon={tool.icon}
            label={t(`skined.tool.${tool.id}`)}
            tip={t(`skined.tool.${tool.id}_tip`)}
          />
        ))}
      </div>
      <ToolButton active={ed.mirror} onClick={() => ed.setMirror(!ed.mirror)} icon={<FlipHorizontal2 size={18} />} label={t("skined.mirror")} tip={t("skined.mirror_tip")} />
      <div className="mt-1 flex items-center gap-2">
        <span className="flex-1 text-meta text-muted">{t("skined.size")}</span>
        <div className="vl-seg inline-flex gap-0.5 rounded-ctl bg-field p-0.5" role="radiogroup" aria-label={t("skined.size")}>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={ed.size === n}
              onClick={() => ed.setSize(n)}
              className={cn(
                "vl-seg-item grid h-7 w-8 place-items-center rounded-[max(0px,calc(var(--r-ctl)-2px))] transition-colors",
                ed.size === n ? "bg-surface3 text-text" : "text-muted hover:text-text",
              )}
            >
              <span className="block bg-current" style={{ width: 3 + n * 3, height: 3 + n * 3 }} />
            </button>
          ))}
        </div>
      </div>
      {ed.tool === "eraser" && ed.layer === "base" && <p className="text-[12px] leading-snug text-dim">{t("skined.eraser_base_hint")}</p>}
    </div>
  );
}
