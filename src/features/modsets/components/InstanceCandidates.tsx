import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { Button, Checkbox, ErrorState, Select, Skeleton, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { formatLoader } from "@/lib/format";
import { useInstances } from "@/lib/queries";
import { entryKey, setsApi, type SetEntry } from "../api";
import { noop } from "./PasteList";

export function InstanceCandidatesList({ instanceId, existing, onSubmit, submitLabel, busy }: { instanceId: string; existing?: Set<string>; onSubmit: (entries: SetEntry[]) => void; submitLabel: (n: number) => string; busy?: boolean }) {
  const t = useT();
  const q = useQuery({ queryKey: ["mod-sets", "candidates", instanceId], queryFn: () => setsApi.instanceCandidates(instanceId), staleTime: 10_000 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (q.data) setSel(new Set(q.data.items.filter((c) => c.enabled && !existing?.has(entryKey(c.entry))).map((c) => entryKey(c.entry))));
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = q.data?.items ?? [];
  const selectable = items.filter((c) => !existing?.has(entryKey(c.entry)));
  if (q.isPending)
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="flex min-h-0 flex-col gap-2">
      {items.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-muted">{t("frominst.empty")}</div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-[12.5px]">
            <button className="font-semibold text-brand hover:underline" onClick={() => setSel(new Set(selectable.map((c) => entryKey(c.entry))))}>
              {t("frominst.all")}
            </button>
            <span className="text-dim">·</span>
            <button className="font-semibold text-muted hover:text-text" onClick={() => setSel(new Set())}>
              {t("frominst.none_sel")}
            </button>
          </div>
          <div className="scroll -mx-2 max-h-[380px]">
            {items.map((c) => {
              const k = entryKey(c.entry);
              const inSet = !!existing?.has(k);
              return (
                <div
                  key={k}
                  onClick={() => !inSet && setSel((s) => (s.has(k) ? (s.delete(k), new Set(s)) : new Set(s).add(k)))}
                  className={cn("flex items-center gap-3 rounded-ctl px-2 py-1.5", inSet ? "opacity-60" : "hover:bg-white/[.03]")}
                >
                  {inSet ? <Check size={16} className="mx-px text-ok" /> : <Checkbox checked={sel.has(k)} onChange={noop} label={c.entry.title} />}
                  <ProjectIcon src={c.entry.icon_url} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-text">{c.entry.title}</div>
                    <div className="truncate text-[12px] text-dim">
                      {t(`sets.type.${c.entry.project_type}`)}
                      {!c.enabled && ` · ${t("frominst.disabled")}`}
                      {inSet && ` · ${t("sets.add.in_set")}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {(q.data?.unknown.length ?? 0) > 0 && (
        <div className="flex items-start gap-2 text-[12px] text-dim">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {t("frominst.unknown", { n: q.data!.unknown.length })}
        </div>
      )}
      <div className="flex justify-end pt-1">
        <Button
          size="sm"
          variant="primary"
          disabled={!sel.size}
          loading={busy}
          onClick={() => onSubmit(items.filter((c) => sel.has(entryKey(c.entry))).map((c) => c.entry))}
        >
          {submitLabel(sel.size)}
        </Button>
      </div>
    </div>
  );
}

export function InstancePicker({ value, onChange, allowVanilla = true }: { value: string | null; onChange: (id: string) => void; allowVanilla?: boolean }) {
  const t = useT();
  const instances = (useInstances().data ?? []).filter((i) => allowVanilla || i.loader.kind !== "vanilla");
  return (
    <Select<string>
      size="sm"
      value={value}
      onChange={onChange}
      placeholder={t("sets.apply_pick")}
      options={instances.map((i) => ({ value: i.id, label: i.name, hint: `${i.mc_version} · ${formatLoader({ kind: i.loader.kind, version: null })}` }))}
    />
  );
}
