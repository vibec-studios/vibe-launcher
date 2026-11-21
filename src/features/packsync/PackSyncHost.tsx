import { useEffect } from "react";
import { qk, queryClient, useJavaInstances } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { useVibe } from "@/lib/vibe";
import type { PackFollow, PackRemovedEvent, PackVersionPublishedEvent } from "@/lib/vibe-sdk";
import { toast } from "@/components/ui";
import { t } from "@/i18n";
import { onGatewayEvent, useSocial } from "@/features/social/service";
import { applyFollowEvent, psk, reconcileInstances, sameCode, vibePackOf } from "./api";
import { PackDiffDialog } from "./DiffDialog";
import { closePackDiff, openPackDiff, usePackDiff } from "./store";

function useGatewayEvents() {
  useEffect(() => {
    const offs = [
      onGatewayEvent("pack.version.published", (raw) => {
        const ev = raw as PackVersionPublishedEvent;
        queryClient.invalidateQueries({ queryKey: psk.following });
        queryClient.invalidateQueries({ queryKey: ["vibe", "pack", ev.pack.code] });
        if (ev.pack.owner.id === useSocial.getState().me?.id) return;
        const list = queryClient.getQueryData<Instance[]>(qk.instances) ?? [];
        const inst = list.find((i) => !!vibePackOf(i) && sameCode(vibePackOf(i)!.code, ev.pack.code));
        const s = ev.summary;
        const text = s ? t("psync.toast.summary", { added: s.added, updated: s.updated, removed: s.removed }) : undefined;
        toast.info(
          t("psync.toast.update", { name: ev.pack.name, v: ev.version.version }),
          text,
          inst ? { label: t("psync.show_changes"), onClick: () => openPackDiff({ instanceId: inst.id, code: ev.pack.code, toVersionId: ev.version.id }) } : undefined,
          15_000,
        );
      }),
      onGatewayEvent("pack.follow.updated", (raw) => applyFollowEvent(raw as PackFollow)),
      onGatewayEvent("pack.removed", (raw) => {
        const ev = raw as PackRemovedEvent;
        queryClient.setQueryData<PackFollow[]>(psk.following, (old) => (old ?? []).filter((f) => !sameCode(f.pack.code, ev.code)));
        toast.info(t("psync.toast.removed", { code: ev.code }), t(`psync.removed.${ev.reason}`));
      }),
    ];
    return () => offs.forEach((f) => f());
  }, []);
}

function useReconcile() {
  const vibe = useVibe();
  const ready = useSocial((s) => s.conn === "ready");
  const { data: instances } = useJavaInstances();
  const key = (instances ?? [])
    .map(vibePackOf)
    .filter(Boolean)
    .map((r) => `${r!.code}:${r!.versionId}`)
    .sort()
    .join(",");
  useEffect(() => {
    if (!vibe.sharing || !ready || !key || !instances) return;
    const timer = setTimeout(() => void reconcileInstances(instances), 1500);
    return () => clearTimeout(timer);
  }, [vibe.sharing, ready, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function PackSyncHost() {
  useGatewayEvents();
  useReconcile();
  const open = usePackDiff((s) => s.open);
  const { data: instances } = useJavaInstances();
  const inst = open ? instances?.find((i) => i.id === open.instanceId) : undefined;
  if (!open || !inst) return null;
  return <PackDiffDialog instance={inst} code={open.code} toVersionId={open.toVersionId} onClose={closePackDiff} />;
}
