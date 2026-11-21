import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { FileContent, FileValidationError } from "@/lib/types";
import { Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";

/** Formate mit Syntaxprüfung im Backend */
export const CHECKED = new Set(["json", "json5", "toml"]);

export function EditorFallback() {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center gap-2 text-[13px] text-dim">
      <Spinner size={14} /> {t("files.loading_editor")}
    </div>
  );
}

export function Banner({ tone, icon, children, action }: { tone: "warn" | "info"; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-b px-4 py-2 text-[12.5px] text-text",
        tone === "warn" ? "border-warn/25 bg-warn/[.07] [&>svg]:text-warn" : "border-line bg-surface [&>svg]:text-muted",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

export function StatusBar({ file, errors, checking, onJump }: { file: FileContent; errors: FileValidationError[]; checking: boolean; onJump: (e: FileValidationError) => void }) {
  const t = useT();
  const checked = CHECKED.has(file.language) && !file.readonly;
  return (
    <div className="shrink-0 border-t border-line bg-surface">
      {errors.length > 0 && (
        <div className="scroll max-h-[92px] border-b border-line py-1">
          {errors.map((e, i) => (
            <button key={i} onClick={() => onJump(e)} className="flex w-full items-baseline gap-3 px-4 py-0.5 text-left text-[12px] hover:bg-white/[.04]">
              <AlertTriangle size={12} className="shrink-0 translate-y-[2px] text-danger" />
              <span className="shrink-0 font-mono text-[11px] text-danger">{t("files.error_at", { line: e.line, col: e.column })}</span>
              <span className="min-w-0 flex-1 truncate text-text">{e.message}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex h-8 items-center gap-3 px-4 text-[12px]">
        {file.readonly ? (
          <span className="text-dim">{t("files.readonly_short")}</span>
        ) : !checked ? (
          <span className="text-dim">{t("files.no_check")}</span>
        ) : checking && !errors.length ? (
          <span className="flex items-center gap-1.5 text-dim">
            <Spinner size={11} /> {t("files.checking")}
          </span>
        ) : errors.length ? (
          <span className="flex items-center gap-1.5 font-semibold text-danger">
            <AlertTriangle size={13} /> {t(errors.length === 1 ? "files.errors_1" : "files.errors", { n: errors.length })}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-ok">
            <CheckCircle2 size={13} /> {t("files.ok")}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-dim">{file.readonly ? t("files.shortcuts_ro") : t("files.shortcuts")}</span>
      </div>
    </div>
  );
}
