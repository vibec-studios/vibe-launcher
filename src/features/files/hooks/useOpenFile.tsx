import { useCallback, useRef, useState, type RefObject } from "react";
import { useBlocker } from "@tanstack/react-router";
import { api } from "@/lib/api";
import type { FileContent, FileScope, FileValidationError } from "@/lib/types";
import { confirm, toast } from "@/components/ui";
import type { useT } from "@/i18n";
import type { CodeEditorHandle } from "../CodeEditor";
import { CHECKED } from "../FilePane";
import type { FileTreeHandle } from "../FileTree";
import { baseName } from "../util";

interface Args {
  scope: FileScope;
  t: ReturnType<typeof useT>;
  refresh: () => Promise<void>;
  expandTo: (path: string, self: boolean) => void;
  setSelected: (path: string | null) => void;
  tree: RefObject<FileTreeHandle | null>;
}

export function useOpenFile({ scope, t, refresh, expandTo, setSelected, tree }: Args) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<FileValidationError[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [initialLine, setInitialLine] = useState<number | null>(null);
  const [autoFocus, setAutoFocus] = useState(false);
  const editor = useRef<CodeEditorHandle>(null);
  const loadSeq = useRef(0);
  const checkSeq = useRef(0);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const fileRef = useRef<FileContent | null>(null);
  fileRef.current = file;
  const openRef = useRef<string | null>(null);
  openRef.current = openPath;

  const askDiscard = useCallback(
    (path: string) =>
      confirm({ title: t("files.unsaved.title"), text: t("files.unsaved.text", { name: baseName(path) }), confirmLabel: t("files.unsaved.confirm"), danger: true }),
    [t],
  );

  useBlocker({
    shouldBlockFn: async () => {
      const f = fileRef.current;
      if (!dirtyRef.current || !f) return false;
      return !(await askDiscard(f.path));
    },
    disabled: !dirty,
    enableBeforeUnload: false,
  });

  const validate = useCallback((path: string, language: string, content: string) => {
    const seq = ++checkSeq.current;
    if (!CHECKED.has(language)) {
      setErrors([]);
      setChecking(false);
      return;
    }
    setChecking(true);
    api
      .filesValidate(path, content)
      .then((e) => seq === checkSeq.current && setErrors(e))
      .catch(() => seq === checkSeq.current && setErrors([]))
      .finally(() => seq === checkSeq.current && setChecking(false));
  }, []);

  const showFile = useCallback(
    (f: FileContent, line: number | null) => {
      setFile(f);
      setDirty(false);
      setErrors([]);
      setInitialLine(line);
      setEditorKey((k) => k + 1);
      if (!f.readonly && f.kind === "text") validate(f.path, f.language, f.content);
      else setChecking(false);
    },
    [validate],
  );

  const load = useCallback(
    async (path: string, line: number | null) => {
      const seq = ++loadSeq.current;
      setOpenPath(path);
      setLoading(true);
      setLoadError(null);
      try {
        const f = await api.filesRead(scope, path);
        if (seq !== loadSeq.current) return;
        showFile(f, line);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setFile(null);
        setDirty(false);
        setLoadError(e);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [scope, showFile],
  );

  const closeFile = useCallback(() => {
    loadSeq.current++;
    setOpenPath(null);
    setFile(null);
    setDirty(false);
    setErrors([]);
    setLoadError(null);
    setLoading(false);
  }, []);

  const openFile = useCallback(
    async (path: string, line: number | null = null, focus = false) => {
      const cur = fileRef.current;
      if (cur && cur.path === path) {
        if (line) editor.current?.gotoLine(line);
        return;
      }
      if (dirtyRef.current && cur && !(await askDiscard(cur.path))) return;
      setAutoFocus(focus);
      expandTo(path, false);
      setSelected(path);
      requestAnimationFrame(() => tree.current?.scrollTo(path));
      void load(path, line);
    },
    [askDiscard, expandTo, load],
  );

  const save = useCallback(async () => {
    const f = fileRef.current;
    if (!f || f.readonly || !editor.current || saving) return;
    const content = editor.current.getValue();
    if (CHECKED.has(f.language)) {
      const errs = await api.filesValidate(f.path, content).catch(() => [] as FileValidationError[]);
      setErrors(errs);
      if (
        errs.length &&
        !(await confirm({ title: t("files.invalid.title"), text: t("files.invalid.text", { n: errs.length }), confirmLabel: t("files.invalid.confirm"), danger: true }))
      ) {
        // Zurück in den Editor, damit man gleich weiter korrigieren kann
        requestAnimationFrame(() => editor.current?.focus());
        return;
      }
    }
    setSaving(true);
    try {
      const nf = await api.filesWrite(scope, f.path, content);
      setFile(nf);
      editor.current?.markClean();
      setDirty(false);
      toast.success(t("files.saved"), nf.path);
      void refresh();
    } catch (e) {
      toast.error(e, t("files.save_failed"));
    } finally {
      setSaving(false);
    }
  }, [refresh, saving, scope, t]);

  const discard = useCallback(() => {
    const f = fileRef.current;
    if (f) showFile(f, null);
  }, [showFile]);

  const reloadFile = useCallback(async () => {
    const f = fileRef.current;
    if (!f) return;
    if (dirtyRef.current && !(await askDiscard(f.path))) return;
    loadSeq.current++;
    void load(f.path, null);
  }, [askDiscard, load]);

  const restore = useCallback(async () => {
    const f = fileRef.current;
    if (!f) return;
    const ok = await confirm({
      title: t("files.restore.title"),
      text: (
        <>
          {t("files.restore.text", { name: baseName(f.path) })}
          {dirtyRef.current && <span className="mt-2 block text-warn">{t("files.restore.text_dirty")}</span>}
        </>
      ),
      confirmLabel: t("files.restore"),
    });
    if (!ok) return;
    try {
      const nf = await api.filesRestore(scope, f.path);
      showFile(nf, null);
      toast.success(t("files.restored"), nf.path);
      void refresh();
    } catch (e) {
      toast.error(e, t("files.restore_failed"));
    }
  }, [refresh, scope, showFile, t]);

  const onContent = useCallback(
    (content: string) => {
      const f = fileRef.current;
      if (f) validate(f.path, f.language, content);
    },
    [validate],
  );

  return { openPath, setOpenPath, file, setFile, loadError, loading, dirty, setDirty, errors, checking, saving, editorKey, initialLine, autoFocus, editor, dirtyRef, openRef, askDiscard, load, closeFile, openFile, save, discard, reloadFile, restore, onContent };
}

export type OpenFile = ReturnType<typeof useOpenFile>;
