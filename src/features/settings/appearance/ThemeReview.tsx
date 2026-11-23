import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import type { ParsedTheme, ThemeWarning } from "@/lib/customThemes";
import { hasExtension } from "@/lib/customThemes";
import { Tag } from "@/components/ui";
import { useT } from "@/i18n";
import { ThemePreview } from "@/features/themes/ThemePreview";

function warningText(t: ReturnType<typeof useT>, w: ThemeWarning): string {
  const base = t(`vt.warn.${w.code}`);
  const detail = w.detail ? `: ${w.detail}` : "";
  return `${base}${detail}${w.count > 1 ? ` (${w.count}×)` : ""}`;
}

export function ThemeReview({ parsed }: { parsed: ParsedTheme }) {
  const t = useT();
  const { doc, warnings, version } = parsed;
  const ext = hasExtension(doc);
  return (
    <div className="flex flex-col gap-3 pb-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-[15px] font-semibold text-text">{doc.name}</span>
        {doc.author && <span className="truncate text-[12.5px] text-muted">{t("vt.import.by", { author: doc.author })}</span>}
        <Tag className="ml-auto">{version === 2 ? t("vt.import.v2") : t("vt.import.v1")}</Tag>
        {ext && (
          <Tag className="text-accent">
            <Sparkles size={11} />
            {t("vt.badge")}
          </Tag>
        )}
      </div>
      {doc.description && <p className="text-[12.5px] leading-relaxed text-muted">{doc.description}</p>}
      <ThemePreview doc={doc} />
      <div className="flex flex-col gap-1.5" role="status">
        {warnings.length === 0 ? (
          <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <CheckCircle2 size={14} className="shrink-0 text-ok" />
            {t("vt.import.clean")}
          </span>
        ) : (
          <>
            <span className="text-[12.5px] font-semibold text-text">{t("vt.import.warnings")}</span>
            <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto pr-1">
              {warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12px] text-muted">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
                  <span className="min-w-0 break-words">{warningText(t, w)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {ext && <span className="text-[12px] text-dim">{t("vt.import.safety")}</span>}
      </div>
    </div>
  );
}
