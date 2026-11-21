import { ArrowRight, FileText, Folder, Globe2, Terminal } from "lucide-react";
import { Checkbox, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { formatBytes } from "@/lib/format";
import type { DataEntry, SettingsChange } from "@/lib/types";
import { formatValue, hookLines } from "../settingsFormat";
import { dataLabel } from "./state";

export function DataRow({ entry: d, launcher, pick, onPick }: { entry: DataEntry; launcher: string; pick: boolean | undefined; onPick: (overwrite: boolean | null) => void }) {
  const t = useT();
  const on = pick !== undefined;
  // Nichts fehlt -> Auswählen heißt Überschreiben (ausdrücklich, nie vorausgewählt)
  const onlyOverwrite = d.missing_files === 0;
  const overwrite = on && (onlyOverwrite || pick === true);
  const Icon = d.kind === "world" ? Globe2 : d.kind === "dir" ? Folder : FileText;
  const status =
    d.status === "partial"
      ? d.missing_files === 1
        ? t("isx.data.status.partial_1")
        : t("isx.data.status.partial_n", { n: d.missing_files })
      : d.status === "newer" && d.kind === "world"
        ? t("isx.data.status.newer_world", { launcher })
        : t(`isx.data.status.${d.status}`);
  const size = formatBytes(onlyOverwrite ? d.overwrite_size : d.missing_size || d.size);
  const label = dataLabel(d);
  const folder = d.path.replace(/^saves\//, "");
  const alsoOverwrite = d.overwrite_files === 1 ? t("isx.data.also_overwrite_1") : t("isx.data.also_overwrite", { n: d.overwrite_files });
  return (
    <div className={cn("flex items-start gap-3 rounded-ctl px-1 py-1.5 hover:bg-white/[.03]", overwrite && "bg-warn/[.06]")}>
      <Checkbox checked={on} onChange={(v) => onPick(v ? onlyOverwrite : null)} label={label} className="mt-0.5" />
      <Icon size={15} className="mt-0.5 shrink-0 text-dim" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[13px] text-text" title={d.path}>
            {label}
          </span>
          {d.kind === "world" && d.name && d.name !== folder && <span className="min-w-0 truncate text-[12px] text-dim">{folder}</span>}
          <span
            className={cn(
              "shrink-0 rounded-xs px-1.5 py-px text-caption",
              d.status === "missing" || d.status === "partial" ? "bg-brand/15 text-brand" : d.status === "newer" ? "bg-warn/15 text-warn" : "bg-white/[.06] text-muted",
            )}
          >
            {status}
          </span>
        </div>
        <div className="text-[12px] text-dim">
          {size}
          {!onlyOverwrite && d.kind !== "file" && d.kind !== "world" && ` · ${d.missing_files === 1 ? t("isx.data.files_1") : t("isx.data.files_n", { n: d.missing_files })}`}
        </div>
        {!onlyOverwrite && d.overwrite_files > 0 && d.kind !== "world" && (
          <div className="mt-1">
            <Checkbox
              checked={pick === true}
              onChange={(v) => onPick(v ? true : on ? false : null)}
              label={alsoOverwrite}
              className="inline-flex"
            />
            <span className="ml-2 text-[12px] text-muted">{alsoOverwrite}</span>
          </div>
        )}
        {overwrite && <p className="mt-0.5 text-[12px] leading-snug text-warn">{d.kind === "world" ? t("isx.data.warn_world") : d.overwrite_files === 1 ? t("isx.data.warn_files_1") : t("isx.data.warn_files", { n: d.overwrite_files })}</p>}
        {d.status === "removed" && !on && <p className="mt-0.5 text-[12px] leading-snug text-dim">{t("isx.data.removed_hint")}</p>}
      </div>
    </div>
  );
}

export function ChangeRow({ change: c, launcher, on, onChange }: { change: SettingsChange; launcher: string; on: boolean; onChange: (on: boolean) => void }) {
  const t = useT();
  const hooks = c.key === "hooks" ? hookLines((c.new ?? {}) as never) : [];
  const keepHint = !c.default_on && c.key !== "hooks";
  return (
    <div className={cn("flex items-start gap-3 px-3 py-1.5", c.key === "hooks" && on && "bg-warn/[.06]")}>
      <Checkbox checked={on} onChange={onChange} label={t(`ext.set.key.${c.key}`)} className="mt-0.5" />
      <div className="w-[150px] shrink-0 pt-px text-[13px] text-muted">{t(`ext.set.key.${c.key}`)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 pt-px text-[13px]">
          <span className="min-w-0 truncate text-dim line-through decoration-white/20">{formatValue(c.key, c.old)}</span>
          <ArrowRight size={12} className="shrink-0 text-dim" />
          {c.key === "icon" && typeof c.new === "string" ? (
            <img src={c.new} alt="" className="h-5 w-5 rounded-xs object-cover" />
          ) : c.key === "hooks" ? null : (
            <span className="min-w-0 truncate font-medium text-text" title={formatValue(c.key, c.new)}>
              {formatValue(c.key, c.new)}
            </span>
          )}
          {c.inherited && <span className="shrink-0 rounded-xs bg-white/[.06] px-1.5 py-px text-caption text-muted">{t("ext.set.inherited", { launcher })}</span>}
        </div>
        {hooks.map((h) => (
          <div key={h.label} className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-warn">
            <Terminal size={12} className="shrink-0" />
            <span className="shrink-0">{h.label}:</span>
            <code className="selectable min-w-0 break-all font-mono text-[11.5px]">{h.cmd}</code>
          </div>
        ))}
        {c.key === "hooks" && <p className="mt-0.5 text-[12px] leading-snug text-warn">{t("isx.hooks_warn")}</p>}
        {keepHint && <p className="mt-0.5 text-[12px] leading-snug text-dim">{t("isx.keep_hint")}</p>}
      </div>
    </div>
  );
}
