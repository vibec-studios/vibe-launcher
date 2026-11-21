import { Copy } from "lucide-react";
import { IconButton, cn } from "@/components/ui";
import { copyText } from "@/features/logs/logText";
import { useT } from "@/i18n";

export function CommandBox({ command, className }: { command: string; className?: string }) {
  const t = useT();
  return (
    <div className={cn("flex items-start gap-2 rounded-card bg-field py-2 pl-3 pr-1.5", className)}>
      <code className="min-w-0 flex-1 select-all break-all py-1 font-mono text-[12.5px] leading-relaxed text-text">{command}</code>
      <IconButton label={t("rmt.install.copy")} tip variant="ghost" size="sm" onClick={() => void copyText(command)}>
        <Copy size={14} />
      </IconButton>
    </div>
  );
}
