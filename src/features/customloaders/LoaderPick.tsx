import { Check } from "lucide-react";
import { Select, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { CustomLoaderPack, CustomLoaderRef } from "@/lib/types";
import { packsById, useCustomLoaders, useCustomLoadersEnabled } from "./api";
import { PackIcon } from "./LoaderBadge";

export function useCustomLoaderChoices(): CustomLoaderPack[] {
  const on = useCustomLoadersEnabled();
  const packs = useCustomLoaders().data;
  return on ? (packs ?? []) : [];
}

export function CustomLoaderCards({ packs, value, onChange }: { packs: CustomLoaderPack[]; value: CustomLoaderRef | null; onChange: (r: CustomLoaderRef) => void }) {
  const t = useT();
  const groups = packsById(packs);
  if (!groups.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-1" role="radiogroup" aria-label={t("cl.pick.label")}>
      <div className="px-1 pb-0.5 pt-1 text-[12px] font-semibold text-muted">{t("cl.pick.label")}</div>
      {groups.map(({ id, versions }) => {
        const head = versions[0];
        const on = value?.id === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && onChange({ id, version: head.loader_version })}
            className={cn(
              "flex min-h-[53px] items-center gap-3 rounded-card px-3 py-2 text-left transition-colors duration-100",
              on ? "bg-surface3 shadow-[inset_0_0_0_1px_var(--accent)]" : "bg-surface2 hover:bg-surface3",
            )}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-ctl bg-surface">
              <PackIcon src={head.icon_path} size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold leading-tight text-text">{head.name}</span>
              <span className="block truncate text-[13px] leading-snug text-muted">
                {versions.length > 1 ? t("cl.pick.versions", { n: versions.length }) : head.loader_version} · {t("cl.pick.experimental")}
              </span>
            </span>
            {on && <Check size={16} strokeWidth={2.5} className="shrink-0 text-accent" />}
          </button>
        );
      })}
    </div>
  );
}

export function CustomLoaderVersionSelect({ packs, value, onChange }: { packs: CustomLoaderPack[]; value: CustomLoaderRef; onChange: (r: CustomLoaderRef) => void }) {
  const t = useT();
  const versions = packsById(packs).find((g) => g.id === value.id)?.versions ?? [];
  if (versions.length < 2) return null;
  return (
    <div className="rounded-card border border-line bg-surface px-3 py-2">
      <div className="mb-1.5 text-[14px] text-muted">{t("cl.pick.version")}</div>
      <Select
        value={value.version}
        onChange={(v) => onChange({ id: value.id, version: v })}
        options={versions.map((p) => ({ value: p.loader_version, label: p.loader_version, hint: p.minecraft.join(", ") }))}
      />
    </div>
  );
}
