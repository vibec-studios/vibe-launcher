import { useNavigate } from "@tanstack/react-router";
import { useMemo, type Dispatch, type MouseEvent, type MutableRefObject, type SetStateAction } from "react";
import { discoverSearchFor } from "@/app/router";
import { startManualDownload } from "@/components/content/install";
import type { ContentItem } from "@/lib/types";
import type { RowActions } from "../ContentRow";
import { OrgMenuItems } from "../organize/OrgMenuItems";
import { keyOf } from "./keys";
import type { ContentActions } from "./useContentActions";
import type { ListStateRef } from "./useContentSelection";

interface Args {
  id: string;
  state: ListStateRef;
  anchor: MutableRefObject<string | null>;
  setSelection: Dispatch<SetStateAction<Set<string>>>;
  byKeys: (keys: Iterable<string>) => ContentItem[];
  ops: ContentActions;
}

export function useRowActions({ id, state, anchor, setSelection, byKeys, ops }: Args) {
  const navigate = useNavigate();
  const { setEnabled, setPinned, update, remove, openFolder } = ops;
  return useMemo<RowActions>(
    () => ({
      click: (key: string, e: MouseEvent) => {
        const { visible: vis, selection: sel } = state.current;
        if (e.shiftKey && anchor.current) {
          const a = vis.findIndex((c) => keyOf(c) === anchor.current);
          const b = vis.findIndex((c) => keyOf(c) === key);
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            const next = e.ctrlKey || e.metaKey ? new Set(sel) : new Set<string>();
            for (let i = lo; i <= hi; i++) next.add(keyOf(vis[i]));
            setSelection(next);
            return;
          }
        }
        anchor.current = key;
        if (e.ctrlKey || e.metaKey) {
          const next = new Set(sel);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          setSelection(next);
        } else {
          setSelection(sel.size === 1 && sel.has(key) ? new Set() : new Set([key]));
        }
      },
      toggle: (key: string) => {
        anchor.current = key;
        const next = new Set(state.current.selection);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setSelection(next);
      },
      context: (key: string) => {
        if (!state.current.selection.has(key)) {
          anchor.current = key;
          setSelection(new Set([key]));
        }
      },
      menuTargets: (key: string) => {
        const sel = state.current.selection;
        return sel.has(key) ? byKeys(sel) : byKeys([key]);
      },
      setEnabled: (items, v) => void setEnabled(items, v),
      setPinned: (items, v) => void setPinned(items, v),
      update: (items) => void update(items),
      manualUpdate: (item) => {
        const u = state.current.updates.get(keyOf(item));
        if (!u) return;
        startManualDownload(id, { source: u.source, id: u.project_id, title: item.name }, u.new_version.id).catch(() => {});
      },
      remove: (items) => void remove(items),
      openProject: (item) =>
        item.source && item.project_id && navigate({ to: "/discover", search: discoverSearchFor(item.source, item.project_id, id, item.kind === "resourcepack" ? "resourcepack" : item.kind === "shader" ? "shader" : item.kind === "datapack" ? "datapack" : "mod") }),
      openFolder,
      hasUpdate: (item) => state.current.updates.has(keyOf(item)),
      isManualUpdate: (item) => !!state.current.updates.get(keyOf(item))?.manual,
      organize: (items, menu) => <OrgMenuItems instanceId={id} items={items} menu={menu} />,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEnabled, setPinned, update, remove, openFolder, navigate, id],
  );
}
