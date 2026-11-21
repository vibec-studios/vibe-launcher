import { Download, Map as MapIcon } from "lucide-react";
import { Button, toast } from "@/components/ui";
import { installKey, startContentInstall, useInstallTasks } from "@/components/content/install";
import { useT } from "@/i18n";
import { useInstance } from "@/lib/queries";
import { XAERO_WORLD_MAP, type MapSource } from "./api";

export const WORLD_SOURCE = "world";

const DIMENSION_KEYS: Record<string, string> = {
  "minecraft:overworld": "world_map.overworld",
  "minecraft:the_nether": "world_map.nether",
  "minecraft:the_end": "world_map.end",
};

export function dimensionLabel(dimension: string, t: (key: string) => string) {
  const key = DIMENSION_KEYS[dimension];
  return key ? t(key) : (dimension.split(/[:/]/).pop() ?? dimension);
}

export function newestPerKind(sources: MapSource[]) {
  const best = new Map<string, MapSource>();
  for (const source of sources) {
    const current = best.get(source.kind);
    if (!current || (source.modified ?? 0) > (current.modified ?? 0)) best.set(source.kind, source);
  }
  return [...best.values()].sort((a, b) => a.kind.localeCompare(b.kind) * -1);
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  if (options.length < 2) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="mr-1 text-xs font-semibold text-muted">{label}</span>
      {options.map((option) => (
        <Button key={option.value} size="sm" variant={value === option.value ? "accent" : "ghost"} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function SourcePicker({ sources, value, withWorld, onChange }: { sources: MapSource[]; value: string; withWorld: boolean; onChange: (value: string) => void }) {
  const t = useT();
  const options = [
    ...(withWorld ? [{ value: WORLD_SOURCE, label: t("mod_map.source.world") }] : []),
    ...newestPerKind(sources).map((source) => ({ value: source.id, label: t(`mod_map.source.${source.kind}`) })),
  ];
  return <Segmented label={t("mod_map.source")} value={value} options={options} onChange={onChange} />;
}

export function DimensionPicker({ dimensions, value, onChange }: { dimensions: string[]; value: string; onChange: (value: string) => void }) {
  const t = useT();
  return (
    <Segmented
      label={t("mod_map.dimension")}
      value={value}
      options={dimensions.map((dimension) => ({ value: dimension, label: dimensionLabel(dimension, t) }))}
      onChange={onChange}
    />
  );
}

export function XaeroInstallHint({ instanceId, server }: { instanceId: string; server?: boolean }) {
  const t = useT();
  const instance = useInstance(instanceId).data;
  const busy = useInstallTasks((state) => Boolean(state.tasks[installKey(instanceId, XAERO_WORLD_MAP)]));
  const modded = instance && !instance.bedrock && instance.loader.kind !== "vanilla";
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-card bg-surface2 p-3.5">
      <MapIcon size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-[150px] flex-1">
        <p className="text-[13px] font-semibold text-text">{t(server ? "mod_map.install.title_server" : "mod_map.install.title")}</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{t(modded ? "mod_map.install.text" : "mod_map.install.vanilla")}</p>
      </div>
      {modded && (
        <Button
          size="sm"
          variant="accent"
          className="ml-auto shrink-0 self-center"
          icon={<Download size={14} />}
          loading={busy}
          disabled={busy}
          onClick={() => void startContentInstall(instanceId, XAERO_WORLD_MAP).catch((error) => toast.error(error, t("mod_map.install.failed")))}
        >
          {t("mod_map.install.action")}
        </Button>
      )}
    </div>
  );
}
