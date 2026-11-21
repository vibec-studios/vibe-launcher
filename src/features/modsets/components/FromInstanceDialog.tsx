import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import { Dialog, Field, Input, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatLoader } from "@/lib/format";
import { useInstances } from "@/lib/queries";
import { entryKey, invalidateSets, setsApi, useSets, type SetEntry } from "../api";
import { InstanceCandidatesList, InstancePicker } from "./InstanceCandidates";
import { addToSet } from "./PasteList";

export function FromInstanceDialog({ instanceId: initial, targetSetId, onClose }: { instanceId: string | null; targetSetId?: string; onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const instances = useInstances().data ?? [];
  const target = useSets().data?.find((s) => s.id === targetSetId);
  const [instanceId, setInstanceId] = useState<string | null>(initial);
  const inst = instances.find((i) => i.id === instanceId);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (inst && !name) setName(inst.name);
  }, [inst]); // eslint-disable-line react-hooks/exhaustive-deps
  const existing = useMemo(() => new Set(target?.entries.map(entryKey) ?? []), [target]);

  const submit = async (entries: SetEntry[]) => {
    setBusy(true);
    try {
      if (target) {
        await addToSet(t, target.id, entries, target.entries.length);
        onClose();
        return;
      }
      const s = await setsApi.create(name.trim() || inst?.name || "Set", entries);
      await invalidateSets();
      toast.success(t("sets.created", { name: s.name }));
      onClose();
      nav({ to: "/modsets", search: { set: s.id } });
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={initial ? t("frominst.title") : t("frominst.title_pick")} description={t("frominst.text")} size="lg">
      <div className="flex flex-col gap-3">
        {!initial && (
          <Field label={t("frominst.instance")}>
            <InstancePicker value={instanceId} onChange={setInstanceId} />
          </Field>
        )}
        {initial && inst && (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <InstanceBadge instance={inst} size={22} />
            {inst.name} · {inst.mc_version} · {formatLoader({ kind: inst.loader.kind, version: null })}
          </div>
        )}
        {!target && (
          <Field label={t("sets.name")}>
            <Input value={name} maxLength={60} placeholder={t("sets.name_placeholder")} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        {instanceId && (
          <InstanceCandidatesList
            key={instanceId}
            instanceId={instanceId}
            existing={target ? existing : undefined}
            busy={busy}
            onSubmit={(e) => void submit(e)}
            submitLabel={(n) => (target ? t("frominst.add_n", { n }) : t("frominst.save_n", { n }))}
          />
        )}
      </div>
    </Dialog>
  );
}
