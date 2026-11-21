import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { api } from "@/lib/api";
import { qk, sqk } from "@/lib/queries";
import type { Instance, ModSide, ServerModCandidate } from "@/lib/types";
import { Checkbox, ErrorState, Field, Select, Skeleton, Switch, Tag, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";

export const NEW_WORLD = "__new__";

const sideColor: Record<ModSide, string> = { both: "var(--color-muted)", server: "var(--color-ok)", client: "var(--color-warn)", unknown: "var(--color-dim)" };

function ModList({
  mods,
  selected,
  setSelected,
}: {
  mods: ServerModCandidate[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
}) {
  const t = useT();
  const clientCount = mods.filter((m) => m.side === "client").length;
  const toggle = (f: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(f);
    else next.delete(f);
    setSelected(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="label flex-1">
          {t("srv.new.mods")} <span className="text-dim">{t("srv.new.mods_count", { n: selected.size, total: mods.length })}</span>
        </span>
        <button type="button" className="rounded-xs text-[12px] text-muted hover:text-text" onClick={() => setSelected(new Set(mods.filter((m) => m.server_ok).map((m) => m.file_name)))}>
          {t("srv.new.mods_suggested")}
        </button>
        <button type="button" className="rounded-xs text-[12px] text-muted hover:text-text" onClick={() => setSelected(new Set(mods.map((m) => m.file_name)))}>
          {t("common.all")}
        </button>
        <button type="button" className="rounded-xs text-[12px] text-muted hover:text-text" onClick={() => setSelected(new Set())}>
          {t("common.none")}
        </button>
      </div>
      {clientCount > 0 && (
        <div className="flex items-start gap-2 rounded-card bg-warn/[.08] px-3 py-2 text-[12px] text-warn">
          <Info size={13} className="mt-px shrink-0" />
          {t("srv.new.client_hint", { n: clientCount })}
        </div>
      )}
      <div className="scroll h-[236px] rounded-card bg-field">
        {mods.map((m) => {
          const on = selected.has(m.file_name);
          return (
            <label
              key={m.file_name}
              className={cn("flex h-9 cursor-pointer items-center gap-3 px-3 hover:bg-white/[.04]", !on && "opacity-70")}
            >
              <Checkbox checked={on} onChange={(v) => toggle(m.file_name, v)} label={m.name ?? m.file_name} />
              <div className="min-w-0 flex-1">
                <div className={cn("truncate text-[13px]", m.enabled ? "text-text" : "text-dim line-through")}>{m.name ?? m.file_name}</div>
              </div>
              <Tooltip content={t(`srv.side.${m.side}.hint`)}>
                <span>
                  <Tag color={sideColor[m.side]}>{t(`srv.side.${m.side}`)}</Tag>
                </span>
              </Tooltip>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function FromInstance({
  instance,
  mods,
  setMods,
  copyConfigs,
  setCopyConfigs,
  world,
  setWorld,
}: {
  instance: Instance;
  mods: Set<string>;
  setMods: (s: Set<string>) => void;
  copyConfigs: boolean;
  setCopyConfigs: (v: boolean) => void;
  world: string;
  setWorld: (v: string) => void;
}) {
  const t = useT();
  const vanilla = instance.loader.kind === "vanilla";
  const cands = useQuery({
    queryKey: sqk.modCandidates(instance.id),
    queryFn: () => api.serverModCandidates(instance.id),
    enabled: !vanilla,
    staleTime: 30_000,
    placeholderData: undefined,
  });
  const worlds = useQuery({ queryKey: qk.worlds(instance.id), queryFn: () => api.worldsList(instance.id), staleTime: 30_000, placeholderData: undefined });

  useEffect(() => {
    setMods(new Set((cands.data ?? []).filter((m) => m.server_ok).map((m) => m.file_name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cands.data]);
  useEffect(() => setWorld(NEW_WORLD), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-5">
      {!vanilla &&
        (cands.isError ? (
          <ErrorState error={cands.error} onRetry={() => cands.refetch()} className="py-6" />
        ) : !cands.data ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-[236px]" />
          </div>
        ) : cands.data.length === 0 ? (
          <p className="text-[13px] text-dim">{t("srv.new.no_mods")}</p>
        ) : (
          <ModList mods={cands.data} selected={mods} setSelected={setMods} />
        ))}
      <div className="grid grid-cols-2 gap-5">
        <Field label={t("srv.new.world")} hint={t("srv.new.world.hint")}>
          <Select
            value={world}
            onChange={setWorld}
            options={[{ value: NEW_WORLD, label: t("srv.new.world.new") }, ...(worlds.data ?? []).map((w) => ({ value: w.folder, label: w.name, hint: w.game_mode ?? undefined }))]}
          />
        </Field>
        {!vanilla && (
          <div className="flex flex-col gap-1.5">
            <span className="label">{t("srv.new.configs")}</span>
            <label className="flex h-10 cursor-pointer items-center gap-3 text-[13px] text-text">
              <Switch checked={copyConfigs} onChange={setCopyConfigs} label={t("srv.new.configs")} />
              {t("srv.new.configs.text")}
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
