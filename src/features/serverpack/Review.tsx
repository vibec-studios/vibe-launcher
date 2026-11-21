import { AlertTriangle, Info, ShieldCheck } from "lucide-react";
import { Checkbox, ErrorState, Field, Select, Skeleton, Switch, Tag, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { formatBytes, formatLoader } from "@/lib/format";
import type { Side } from "@/lib/types";
import type { ServerTargetInfo } from "@/features/installtarget/types";
import { softwareLabel } from "@/features/discover/server/parts";
import type { PackPreview } from "./api";

const sideColor: Record<Side, string> = { both: "var(--color-muted)", server: "var(--color-ok)", client: "var(--color-warn)", unknown: "var(--color-dim)" };
export const NO_WORLD = "__none";

function Notice({ tone, children }: { tone: "warn" | "info" | "danger"; children: React.ReactNode }) {
  const cls = tone === "warn" ? "bg-warn/[.08] text-warn" : tone === "danger" ? "bg-danger/[.1] text-danger" : "bg-accent/[.08] text-text";
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div className={cn("flex items-start gap-2 rounded-card px-3 py-2 text-[12.5px] leading-snug", cls)}>
      <Icon size={14} className="mt-px shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function ReviewStep({
  preview,
  error,
  retry,
  target,
  running,
  isNew,
  selected,
  setSelected,
  configs,
  setConfigs,
  world,
  setWorld,
}: {
  preview: PackPreview | undefined;
  error: unknown;
  retry: () => void;
  target: ServerTargetInfo | null;
  running: boolean;
  isNew: boolean;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  configs: boolean;
  setConfigs: (v: boolean) => void;
  world: string;
  setWorld: (w: string) => void;
}) {
  const t = useT();
  if (error) return <ErrorState error={error} onRetry={retry} className="py-8" />;
  if (!preview)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-[240px]" />
      </div>
    );
  const p = preview;
  const mods = p.entries;
  const clientCount = mods.filter((m) => m.side === "client").length;
  const toggle = (path: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(path);
    else next.delete(path);
    setSelected(next);
  };
  const software = `${formatLoader(p.loader)} · Minecraft ${p.mc_version}`;
  const remoteDiff = !isNew && target && target.origin === "remote" && (target.platform || target.mc_version !== p.mc_version || target.loader.kind !== p.loader.kind);
  const diff = p.target;
  return (
    <div className="flex flex-col gap-4" data-testid="pack-review">
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-text">
            {p.name}
            {p.version_name && <span className="ml-2 text-[12.5px] font-medium text-dim">{p.version_name}</span>}
          </div>
          <div className="text-[12.5px] text-muted">{software}</div>
        </div>
        <Tag>{t(`sp.format.${p.format}`)}</Tag>
      </div>
      <div className="flex flex-col gap-2">
        {p.loader.kind === "vanilla" && <Notice tone="info">{t("sp.notice.vanilla")}</Notice>}
        {running && target && <Notice tone="danger">{t("sp.notice.running", { server: target.name })}</Notice>}
        {diff?.changes_software && (
          <Notice tone="warn">
            {t("sp.notice.switch", {
              server: diff.name,
              from: `${diff.platform ? diff.platform[0].toUpperCase() + diff.platform.slice(1) : formatLoader(diff.loader_from)} ${diff.mc_from}`,
              to: software,
            })}
          </Notice>
        )}
        {remoteDiff && target && <Notice tone="warn">{t("sp.notice.switch", { server: target.name, from: `${softwareLabel(target)} ${target.mc_version}`, to: software })}</Notice>}
        {diff && diff.removes.length > 0 && (
          <Notice tone="info">{diff.managed ? t("sp.notice.replace_managed", { n: diff.removes.length, pack: diff.managed }) : t("sp.notice.replace_all", { n: diff.removes.length })}</Notice>
        )}
        {p.missing.length > 0 && <Notice tone="warn">{t("sp.notice.missing", { n: p.missing.length, files: p.missing.slice(0, 3).join(", ") })}</Notice>}
        {p.client_skipped > 0 && <Notice tone="info">{t("sp.notice.client_skipped", { n: p.client_skipped })}</Notice>}
        {!isNew && (
          <div className="flex items-start gap-2 px-1 text-[12px] text-dim">
            <ShieldCheck size={13} className="mt-px shrink-0 text-ok" />
            {t("sp.notice.snapshot")}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="label flex-1">
            {t("sp.mods")} <span className="text-dim">{t("srv.new.mods_count", { n: selected.size, total: mods.length })}</span>
          </span>
          <button type="button" className="rounded-xs text-[12px] text-muted hover:text-text" onClick={() => setSelected(new Set(mods.filter((m) => m.include).map((m) => m.path)))}>
            {t("srv.new.mods_suggested")}
          </button>
          <button type="button" className="rounded-xs text-[12px] text-muted hover:text-text" onClick={() => setSelected(new Set(mods.map((m) => m.path)))}>
            {t("common.all")}
          </button>
          <button type="button" className="rounded-xs text-[12px] text-muted hover:text-text" onClick={() => setSelected(new Set())}>
            {t("common.none")}
          </button>
        </div>
        {clientCount > 0 && <Notice tone="warn">{t("srv.new.client_hint", { n: clientCount })}</Notice>}
        {mods.length === 0 ? (
          <p className="text-[13px] text-dim">{t("sp.no_mods")}</p>
        ) : (
          <div className="scroll h-[220px] rounded-card bg-field" data-testid="pack-mods">
            {mods.map((m) => {
              const on = selected.has(m.path);
              return (
                <label key={m.path} className={cn("flex h-9 cursor-pointer items-center gap-3 px-3 hover:bg-white/[.04]", !on && "opacity-70")}>
                  <Checkbox checked={on} onChange={(v) => toggle(m.path, v)} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text" title={m.path}>
                    {m.name}
                    {!m.enabled && <span className="ml-2 text-[11.5px] text-dim">{t("sp.disabled")}</span>}
                  </span>
                  {m.size != null && <span className="shrink-0 text-[11.5px] tabular-nums text-dim">{formatBytes(m.size)}</span>}
                  <Tag color={sideColor[m.side]}>{t(`srv.side.${m.side}`)}</Tag>
                </label>
              );
            })}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="label">{t("sp.configs")}</span>
          <label className="flex min-h-10 cursor-pointer items-center gap-3 text-[13px] text-text">
            <Switch checked={configs} onChange={setConfigs} label={t("sp.configs")} disabled={p.config_files === 0} />
            {p.config_files === 0 ? t("sp.configs_none") : t("sp.configs_text", { n: p.config_files, dirs: p.config_dirs.slice(0, 4).join(", ") })}
          </label>
        </div>
        {isNew && p.worlds.length > 0 && (
          <Field label={t("srv.new.world")} hint={t("srv.new.world.hint")}>
            <Select value={world} onChange={setWorld} options={[{ value: NO_WORLD, label: t("srv.new.world.new") }, ...p.worlds.map((w) => ({ value: w, label: w }))]} />
          </Field>
        )}
      </div>
    </div>
  );
}
