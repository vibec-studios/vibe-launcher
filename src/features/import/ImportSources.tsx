import { AppWindow, ChevronRight, FileArchive, FolderOpen } from "lucide-react";
import { useT } from "@/i18n";
import type { ImportMode } from "./importStore";

const sources = [
  { mode: "file", icon: FileArchive },
  { mode: "launcher", icon: AppWindow },
  { mode: "folder", icon: FolderOpen },
] as const;

export function ImportSources({ onSelect }: { onSelect: (mode: ImportMode) => void }) {
  const t = useT();
  return (
    <div data-tour="import-mode" className="grid min-w-0 gap-3">
      {sources.map(({ mode, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          onClick={() => onSelect(mode)}
          className="group flex w-full min-w-0 items-center gap-4 rounded-card border border-line bg-surface px-4 py-4 text-left transition-colors hover:border-accent/60 hover:bg-surface2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-ctl bg-surface3 text-accent"><Icon size={22} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold text-text">{t(`import.source.${mode}`)}</span>
            <span className="mt-0.5 block text-[14px] text-muted">{t(`import.source.${mode}.desc`)}</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-muted group-hover:text-accent" />
        </button>
      ))}
    </div>
  );
}
