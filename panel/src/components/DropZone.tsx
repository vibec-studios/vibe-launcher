import { useRef, useState, type ReactNode } from "react";
import { UploadCloud } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "./ui";

export function DropZone({ accept, multiple, onFiles, children, compact }: { accept?: string; multiple?: boolean; onFiles: (f: File[]) => void; children?: ReactNode; compact?: boolean }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed text-center transition-colors",
        compact ? "px-4 py-5" : "px-6 py-10",
        over ? "border-brand bg-brand/8" : "border-line2 hover:border-brand/50 hover:bg-white/[.02]",
      )}
    >
      <UploadCloud size={compact ? 22 : 30} className="text-accent" />
      <div className="text-[13.5px] font-semibold">{children ?? t("drop.title")}</div>
      <div className="text-meta text-muted">{t("drop.hint")}</div>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
