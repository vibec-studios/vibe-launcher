import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toast } from "@/components/ui";
import { t as tt } from "@/i18n";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { qk, queryClient, waitForTask } from "@/lib/queries";
import type { ContentItem, ContentKind } from "@/lib/types";
import { kindFolder } from "@/components/content/util";
import { setContentFilter, setUpdateTask } from "../contentView";
import { confirmRemoval } from "../organize/removeFlow";
import { itemKey, keyOf } from "./keys";
import type { ListStateRef } from "./useContentSelection";

export function useContentActions(id: string, state: ListStateRef, setSelection: Dispatch<SetStateAction<Set<string>>>) {
  // ---------------------------------------------------------------- Aktionen (je Eintrag nach Art)
  const setEnabled = useCallback(
    async (items: ContentItem[], enabled: boolean) => {
      const targets = items.filter((i) => i.enabled !== enabled);
      if (!targets.length) return;
      const keys = new Set(targets.map(keyOf));
      for (const k of new Set(targets.map((i) => i.kind))) {
        await queryClient.cancelQueries({ queryKey: qk.content(id, k) });
        queryClient.setQueryData<ContentItem[]>(qk.content(id, k), (l) => l?.map((c) => (keys.has(keyOf(c)) ? { ...c, enabled } : c)));
      }
      let failedN = 0;
      let lastErr: unknown;
      for (let i = 0; i < targets.length; i += 8) {
        await Promise.all(
          targets.slice(i, i + 8).map((it) =>
            api
              .contentSetEnabled(id, it.kind, it.file_name, enabled)
              .then((r) => queryClient.setQueryData<ContentItem[]>(qk.content(id, it.kind), (l) => l?.map((c) => (keyOf(c) === keyOf(it) ? r : c))))
              .catch((e) => {
                failedN++;
                lastErr = e;
              }),
          ),
        );
      }
      if (failedN) {
        toast.error(lastErr, tt("content.toggle_failed", { n: failedN }));
        queryClient.invalidateQueries({ queryKey: ["content", id] });
      }
    },
    [id],
  );

  const setPinned = useCallback(
    async (items: ContentItem[], pinned: boolean) => {
      const targets = items.filter((i) => i.pinned !== pinned);
      if (!targets.length) return;
      const keys = new Set(targets.map(keyOf));
      for (const k of new Set(targets.map((i) => i.kind)))
        queryClient.setQueryData<ContentItem[]>(qk.content(id, k), (l) => l?.map((c) => (keys.has(keyOf(c)) ? { ...c, pinned } : c)));
      try {
        for (const it of targets) await api.contentSetPinned(id, it.kind, it.file_name, pinned);
      } catch (e) {
        toast.error(e);
      }
      queryClient.invalidateQueries({ queryKey: ["content", id] });
      queryClient.invalidateQueries({ queryKey: qk.contentUpdates(id) });
    },
    [id],
  );

  const remove = useCallback(
    async (items: ContentItem[]) => {
      if (!items.length) return;
      const extras = await confirmRemoval(
        id,
        items,
        items.length > 1 ? tt("content.remove_title_n", { n: items.length }) : tt("content.remove_title", { name: items[0].name }),
        tt("content.remove_text"),
        tt("common.remove"),
      );
      if (!extras) return;
      const extraKeys = new Set(extras.map((e) => itemKey(e.kind, e.file_name)));
      items = [...items, ...state.current.all.filter((c) => extraKeys.has(keyOf(c)) && !items.some((i) => keyOf(i) === keyOf(c)))];
      const keys = new Set(items.map(keyOf));
      setSelection((s) => new Set([...s].filter((k) => !keys.has(k))));
      for (const k of new Set(items.map((i) => i.kind))) {
        queryClient.setQueryData<ContentItem[]>(qk.content(id, k), (l) => l?.filter((c) => !keys.has(keyOf(c))));
        try {
          await api.contentRemove(
            id,
            k,
            items.filter((i) => i.kind === k).map((i) => i.file_name),
          );
        } catch (e) {
          toast.error(e, tt("content.remove_failed"));
        }
      }
      queryClient.invalidateQueries({ queryKey: ["content", id] });
    },
    [id],
  );

  const update = useCallback(
    async (all: ContentItem[]) => {
      if (!all.length) return;
      // Gesperrte CurseForge-Downloads nie automatisch – überspringen und danach nennen
      const isManual = (i: ContentItem) => !!state.current.updates.get(keyOf(i))?.manual;
      const items = all.filter((i) => !isManual(i));
      const manualN = all.length - items.length;
      const skipped = manualN ? (manualN === 1 ? tt("manual.updates_skipped_1") : tt("manual.updates_skipped", { n: manualN })) : null;
      const showManual = { label: tt("manual.show"), onClick: () => setContentFilter(id, "updates") };
      if (!items.length) {
        toast.info(skipped, tt("manual.updates_skipped_text"), showManual, 8000);
        return;
      }
      try {
        const taskId = await api.contentUpdate(
          id,
          items.map((i) => i.file_name),
        );
        setUpdateTask(id, taskId);
        waitForTask(taskId)
          .then(() => {
            if (skipped) toast.success(tt("content.updated", { n: items.length }), skipped, showManual);
            else toast.success(tt("content.updated", { n: items.length }));
            queryClient.invalidateQueries({ queryKey: ["content", id] });
            queryClient.invalidateQueries({ queryKey: qk.contentUpdates(id) });
          })
          .catch((e) => !isCancelled(e) && toast.error(tt("content.update_failed"), errorMessage(e)));
      } catch (e) {
        toast.error(e, tt("content.update_failed"));
      }
    },
    [id],
  );

  const openFolder = useCallback(
    (kind: ContentKind) => {
      api.instanceOpenFolder(id, kindFolder[kind]).catch((e) => toast.error(e));
    },
    [id],
  );

  return { setEnabled, setPinned, remove, update, openFolder };
}

export type ContentActions = ReturnType<typeof useContentActions>;
