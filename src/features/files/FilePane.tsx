// Rechte Seite des Datei-Bereichs: Kopfzeile mit Aktionen, Hinweise (läuft gerade, nur lesend), dann je nach
// Datei der CodeMirror-Editor (lazy), eine Bildvorschau oder eine Info-Karte für große/binäre Dateien.
import { Suspense, lazy, type ReactNode, type Ref } from "react";
import { AlertTriangle, ClipboardCopy, Copy, ExternalLink, History, Info, MoreHorizontal, Pencil, RefreshCw, Save, Trash2, Undo2 } from "lucide-react";
import type { FileContent, FileEntry, FileScope, FileValidationError } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { Button, DropdownItem, DropdownMenu, DropdownSeparator, ErrorState, IconButton, Skeleton, Spinner, Tag, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import type { CodeEditorHandle } from "./CodeEditor";
import type { FileActions } from "./FileTree";
import { FileIcon, baseName } from "./util";
import { Banner, EditorFallback, StatusBar } from "./pane/parts";
import { ImagePreview, InfoCard } from "./pane/previews";

export { CHECKED } from "./pane/parts";

const CodeEditor = lazy(() => import("./CodeEditor"));

export interface FilePaneProps {
  scope: FileScope;
  /** Geöffneter Pfad (auch während des Ladens) */
  path: string | null;
  file: FileContent | null;
  entry: FileEntry | null;
  loading: boolean;
  loadError: unknown;
  onRetry: () => void;
  dirty: boolean;
  errors: FileValidationError[];
  checking: boolean;
  saving: boolean;
  editorKey: number;
  initialLine: number | null;
  autoFocus: boolean;
  editorRef: Ref<CodeEditorHandle>;
  onDirty: (d: boolean) => void;
  onContent: (c: string) => void;
  onJump: (e: FileValidationError) => void;
  onSave: () => void;
  onDiscard: () => void;
  onRestore: () => void;
  onReloadFile: () => void;
  running: boolean;
  runningText: string;
  actions: FileActions;
  empty: ReactNode;
}

export function FilePane(p: FilePaneProps) {
  const t = useT();
  const { file, path } = p;
  if (!path) return <>{p.empty}</>;
  if (p.loadError && !p.loading) return <ErrorState error={p.loadError} onRetry={p.onRetry} className="flex-1" />;
  if (!file)
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <EditorFallback />
      </div>
    );
  const reason = file.readonly_reason;
  const textual = file.kind === "text" && reason !== "too_large";
  const editable = textual && !file.readonly;
  const entry: FileEntry = p.entry ?? {
    name: baseName(file.path),
    path: file.path,
    is_dir: false,
    size: file.size,
    modified: file.modified,
    kind: file.kind,
    children: null,
    has_backup: file.has_backup,
  };
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
        <FileIcon entry={entry} size={18} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="selectable truncate font-mono text-[13px] font-medium text-text" title={file.path}>
              {file.path}
            </span>
            {p.dirty && <Tag color="#ffb547">{t("files.dirty")}</Tag>}
            {p.loading && <Spinner size={12} className="text-dim" />}
          </div>
          <div className="mt-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-[11.5px] text-dim">
            <span className="uppercase tracking-[.06em]">{file.kind === "text" ? file.language : t(`files.type.${file.kind}`)}</span>
            <span>·</span>
            <span>{formatBytes(file.size)}</span>
            <span>·</span>
            <span>
              {t("files.modified")} {formatRelative(file.modified)}
            </span>
            {file.has_backup && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <History size={11} /> {t("files.has_backup")}
                </span>
              </>
            )}
          </div>
        </div>
        {editable && (
          <>
            <Tooltip content={file.has_backup ? t("files.restore.tip") : t("files.restore.none")}>
              <span>
                <Button size="sm" variant="subtle" icon={<History size={13} />} disabled={!file.has_backup} onClick={p.onRestore}>
                  {t("files.restore")}
                </Button>
              </span>
            </Tooltip>
            <Button size="sm" icon={<Undo2 size={13} />} disabled={!p.dirty} onClick={p.onDiscard}>
              {t("files.discard")}
            </Button>
            <Button size="sm" variant="accent" icon={<Save size={13} />} disabled={!p.dirty} loading={p.saving} onClick={p.onSave}>
              {t("files.save")}
            </Button>
          </>
        )}
        <DropdownMenu
          trigger={
            <IconButton label={t("files.more")} size="sm">
              <MoreHorizontal size={15} />
            </IconButton>
          }
        >
          <DropdownItem icon={<RefreshCw size={14} />} onSelect={p.onReloadFile}>
            {t("files.reload_file")}
          </DropdownItem>
          <DropdownItem icon={<ExternalLink size={14} />} onSelect={() => p.actions.reveal(file.path)}>
            {t("files.act.reveal")}
          </DropdownItem>
          <DropdownItem icon={<ClipboardCopy size={14} />} onSelect={() => p.actions.copyPath(file.path, false)}>
            {t("files.act.copy_path")}
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<Pencil size={14} />} onSelect={() => p.actions.rename(entry)}>
            {t("files.act.rename")}
          </DropdownItem>
          <DropdownItem icon={<Copy size={14} />} onSelect={() => p.actions.duplicate(entry)}>
            {t("files.act.duplicate")}
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<Trash2 size={14} />} danger onSelect={() => p.actions.remove(entry)}>
            {t("files.act.delete")}
          </DropdownItem>
        </DropdownMenu>
      </div>
      {p.running && editable && (
        <Banner tone="warn" icon={<AlertTriangle size={14} className="shrink-0" />}>
          {p.runningText}
        </Banner>
      )}
      {textual && reason && (
        <Banner tone={reason === "encoding" ? "warn" : "info"} icon={<Info size={14} className="shrink-0" />}>
          {t(`files.readonly.${reason}`)}
        </Banner>
      )}
      <div className="relative min-h-0 flex-1">
        {file.kind === "image" ? (
          <ImagePreview scope={p.scope} file={file} />
        ) : !textual ? (
          <InfoCard file={file} actions={p.actions} />
        ) : (
          <Suspense fallback={<EditorFallback />}>
            <CodeEditor
              key={p.editorKey}
              ref={p.editorRef}
              initial={file.content}
              language={file.language}
              readOnly={file.readonly}
              autoFocus={p.autoFocus}
              initialLine={p.initialLine}
              errors={p.errors}
              onDirty={p.onDirty}
              onContent={p.onContent}
            />
          </Suspense>
        )}
      </div>
      {textual && <StatusBar file={file} errors={p.errors} checking={p.checking} onJump={p.onJump} />}
    </>
  );
}
