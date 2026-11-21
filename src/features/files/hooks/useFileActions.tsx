import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "@/lib/api";
import type { FileScope } from "@/lib/types";
import { confirm, toast } from "@/components/ui";
import type { useT } from "@/i18n";
import type { NameDialog } from "../components/NameDialog";
import type { FileActions } from "../FileTree";
import { baseName, copyText, dirName, isInside } from "../util";
import type { OpenFile } from "./useOpenFile";

interface Args {
  scope: FileScope;
  t: ReturnType<typeof useT>;
  refresh: () => Promise<void>;
  expandTo: (path: string, self: boolean) => void;
  revealInTree: (path: string, openSelf?: boolean) => void;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  f: OpenFile;
}

export function useFileActions({ scope, t, refresh, expandTo, revealInTree, setSelected, setExpanded, f }: Args) {
  const { openFile, closeFile, askDiscard, openRef, dirtyRef, setOpenPath, setFile } = f;
  const [nameDialog, setNameDialog] = useState<NameDialog>(null);

  const importPaths = useCallback(
    async (dir: string, paths: string[]) => {
      if (!paths.length) return;
      try {
        const out = await api.filesImport(scope, dir, paths);
        const where = dir ? `${dir}/` : t("files.root");
        toast.success(out.length === 1 ? t("files.imported_one", { name: baseName(out[0]), dir: where }) : t("files.imported", { n: out.length, dir: where }));
        if (dir) expandTo(dir, true);
        await refresh();
        if (out.length === 1) revealInTree(out[0]);
      } catch (e) {
        toast.error(e, t("files.import_failed"));
      }
    },
    [expandTo, refresh, revealInTree, scope, t],
  );

  const actions: FileActions = useMemo(
    () => ({
      open: (e) => {
        if (e.is_dir) revealInTree(e.path, true);
        else void openFile(e.path);
      },
      newItem: (kind, dir) => setNameDialog({ kind, dir }),
      rename: (entry) => setNameDialog({ kind: "rename", entry }),
      importInto: async (dir, folder) => {
        const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
        const picked = await openDialog({ multiple: true, directory: folder }).catch(() => null);
        const list = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
        await importPaths(dir, list);
      },
      duplicate: async (e) => {
        try {
          const p = await api.filesDuplicate(scope, e.path);
          toast.success(t("files.duplicated", { name: baseName(p) }));
          await refresh();
          revealInTree(p);
        } catch (err) {
          toast.error(err, t("files.action_failed"));
        }
      },
      remove: async (e) => {
        const open = openRef.current;
        const affectsOpen = !!open && isInside(open, e.path);
        if (e.is_dir && (e.children ?? 0) > 0) {
          const ok = await confirm({
            title: t("files.delete_dir.title"),
            text: (
              <>
                {t("files.delete_dir.text", { name: e.name, n: e.children ?? 0 })}
                {affectsOpen && dirtyRef.current && <span className="mt-2 block text-warn">{t("files.delete_open.text")}</span>}
              </>
            ),
            confirmLabel: t("files.delete_dir.confirm"),
            danger: true,
          });
          if (!ok) return;
        } else if (affectsOpen && dirtyRef.current && !(await askDiscard(open!))) return;
        try {
          let out = await api.filesDelete(scope, [e.path]);
          if (out.trash_error && !out.deleted) {
            const ok = await confirm({
              title: t("files.delete_perm.title"),
              text: t("files.delete_perm.text", { name: e.name, reason: out.trash_error }),
              confirmLabel: t("files.delete_perm.confirm"),
              danger: true,
            });
            if (!ok) return;
            out = await api.filesDelete(scope, [e.path], true);
          }
          if (affectsOpen) closeFile();
          setSelected((s) => (s && isInside(s, e.path) ? dirName(e.path) || null : s));
          toast.success(out.trashed ? t("files.trashed") : t("files.deleted"), e.path);
          await refresh();
        } catch (err) {
          toast.error(err, t("files.action_failed"));
        }
      },
      reveal: (path) => void api.filesReveal(scope, path).catch((e) => toast.error(e)),
      copyPath: async (path, relative) => {
        try {
          await copyText(relative ? path || "." : await api.filesAbsPath(scope, path));
          toast.success(t("files.copied"), relative ? path : undefined);
        } catch (e) {
          toast.error(e);
        }
      },
    }),
    [askDiscard, closeFile, importPaths, openFile, refresh, revealInTree, scope, t],
  );

  const submitName = useCallback(
    async (name: string) => {
      const st = nameDialog;
      if (!st) return;
      if (st.kind === "rename") {
        const old = st.entry.path;
        const np = await api.filesRename(scope, old, name);
        setNameDialog(null);
        // Aufgeklappte Ordner, Markierung und geöffnete Datei mitnehmen
        const move = (p: string) => (isInside(p, old) ? np + p.slice(old.length) : p);
        setExpanded((s) => new Set([...s].map(move)));
        setSelected((s) => (s ? move(s) : s));
        const open = openRef.current;
        if (open && isInside(open, old)) {
          setOpenPath(move(open));
          setFile((f) => (f ? { ...f, path: move(f.path) } : f));
        }
        toast.success(t("files.renamed", { name: baseName(np) }));
        await refresh();
        revealInTree(np);
        return;
      }
      const p = await api.filesCreate(scope, st.dir, name, st.kind === "folder");
      setNameDialog(null);
      toast.success(t("files.created", { name: baseName(p) }));
      if (st.dir) expandTo(st.dir, true);
      await refresh();
      if (st.kind === "file") void openFile(p, null, true);
      else revealInTree(p);
    },
    [expandTo, nameDialog, openFile, refresh, revealInTree, scope, t],
  );

  return { nameDialog, setNameDialog, importPaths, actions, submitName };
}
