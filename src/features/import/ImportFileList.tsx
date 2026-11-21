import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { SideFilterBar, SideTag, countSides, sideMatches, type SideFilter } from "@/components/content/sides";
import { useT } from "@/i18n";
import type { ImportFile } from "@/lib/types";

export function ImportFileList({ files }: { files: ImportFile[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<SideFilter>("all");
  const counts = useMemo(() => countSides(files, (f) => f.side), [files]);
  const shown = files.filter((f) => sideMatches(side, f.side));
  return (
    <div className="rounded-card bg-surface">
      <button className="flex w-full items-center gap-2 rounded-card px-4 py-3 text-left text-[14px] font-medium text-text hover:bg-white/[.03]" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {t("modpack.files")}
        <span className="text-dim">{files.length}</span>
      </button>
      {open && (
        <div className="border-t border-line">
          <SideFilterBar value={side} onChange={setSide} counts={counts} className="px-2 py-1.5" />
          <div className="scroll max-h-[200px] border-t border-line">
            {shown.map((f) => (
              <div key={f.path} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/[.03]">
                <span className="min-w-0 flex-1 truncate text-meta text-text">{f.path}</span>
                <SideTag side={f.side} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
