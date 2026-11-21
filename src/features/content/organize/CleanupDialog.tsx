import { useMemo, useState } from "react";
import { Button, Dialog, EmptyState, toast } from "@/components/ui";
import { Term } from "@/features/help/glossary/Term";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { ContentItem, ContentKind } from "@/lib/types";
import { organizeApi, orgItemKey, setOrganize, toTargets, useOrganize } from "./api";
import { DepChecklist } from "./DepChecklist";

export function CleanupDialog({ instanceId, items, onClose }: { instanceId: string; items: ContentItem[]; onClose: () => void }) {
  const t = useT();
  const { data } = useOrganize(instanceId);
  const unused = useMemo(() => {
    const info = new Map((data?.items ?? []).map((i) => [orgItemKey(i.kind, i.file), i]));
    return items.filter((c) => info.get(orgItemKey(c.kind, c.file_name))?.unused);
  }, [data, items]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(unused.map((c) => orgItemKey(c.kind, c.file_name))));
  const [busy, setBusy] = useState<"remove" | "keep" | null>(null);
  const chosen = unused.filter((c) => picked.has(orgItemKey(c.kind, c.file_name)));

  const remove = async () => {
    setBusy("remove");
    try {
      const kinds = new Set<ContentKind>(chosen.map((c) => c.kind));
      for (const k of kinds) await api.contentRemove(instanceId, k, chosen.filter((c) => c.kind === k).map((c) => c.file_name));
      toast.success(t("org.cleanup.removed", { n: chosen.length }));
      await queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
      onClose();
    } catch (e) {
      toast.error(e, t("content.remove_failed"));
    } finally {
      setBusy(null);
    }
  };

  const keep = async () => {
    setBusy("keep");
    try {
      setOrganize(instanceId, await organizeApi.keep(instanceId, toTargets(chosen)));
      toast.success(t("org.cleanup.kept", { n: chosen.length }));
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("org.cleanup.title")}
      size="md"
      footer={
        unused.length > 0 ? (
          <>
            <Button variant="subtle" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="subtle" loading={busy === "keep"} disabled={!chosen.length || !!busy} onClick={() => void keep()}>
              {t("org.cleanup.keep", { n: chosen.length })}
            </Button>
            <Button variant="danger" loading={busy === "remove"} disabled={!chosen.length || !!busy} onClick={() => void remove()}>
              {t("org.cleanup.remove", { n: chosen.length })}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t("common.close")}</Button>
        )
      }
    >
      {unused.length === 0 ? (
        <EmptyState icon="sparkle" title={t("org.cleanup.empty")} text={t("org.cleanup.empty_text")} />
      ) : (
        <div className="flex flex-col gap-3 pb-1">
          <p className="text-[13px] leading-relaxed text-muted">
            {t(unused.length === 1 ? "org.cleanup.intro_a1" : "org.cleanup.intro_a")} <Term id="dependency">{t(unused.length === 1 ? "org.dep.one" : "org.dep.many")}</Term> {t(unused.length === 1 ? "org.cleanup.intro_b1" : "org.cleanup.intro_b")}
          </p>
          <DepChecklist
            rows={unused.map((c) => ({ key: orgItemKey(c.kind, c.file_name), name: c.name, icon: c.icon, detail: c.version ? `${c.version} · ${c.file_name}` : c.file_name, enabled: c.enabled }))}
            picked={picked}
            onChange={setPicked}
          />
          <p className="text-[12px] text-dim">{t("org.cleanup.hint")}</p>
        </div>
      )}
    </Dialog>
  );
}
