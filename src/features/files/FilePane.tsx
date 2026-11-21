// Rechte Seite des Datei-Bereichs: Kopfzeile mit Aktionen, Hinweise (läuft gerade, nur lesend), dann je nach
// Datei der CodeMirror-Editor (lazy), eine Bildvorschau oder eine Info-Karte für große/binäre Dateien.
import { Suspense, lazy, useState, type ReactNode, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Copy, ExternalLink, History, Info, MoreHorizontal, Pencil, RefreshCw, Save, Trash2, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import type { FileContent, FileEntry, FileScope, FileValidationError } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { Button, DropdownItem, DropdownMenu, DropdownSeparator, EmptyState, ErrorState, IconButton, Skeleton, Spinner, Tag, Tooltip, cn } from "@/components/ui";
import { useLang, useT } from "@/i18n";
import type { CodeEditorHandle } from "./CodeEditor";
import type { FileActions } from "./FileTree";
import { FileIcon, baseName, extOf, fullDate, scopeKey } from "./util";

const CodeEditor = lazy(() => import("./CodeEditor"));

/** Formate mit Syntaxprüfung im Backend */
export const CHECKED = new Set(["json", "json5", "toml"]);

function EditorFallback() {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center gap-2 text-[13px] text-dim">
      <Spinner size={14} /> {t("files.loading_editor")}
    </div>
  );
}

function Banner({ tone, icon, children, action }: { tone: "warn" | "info"; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-b px-4 py-2 text-[12.5px] text-text",
        tone === "warn" ? "border-warn/25 bg-warn/[.07] [&>svg]:text-warn" : "border-line bg-surface [&>svg]:text-muted",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

function StatusBar({ file, errors, checking, onJump }: { file: FileContent; errors: FileValidationError[]; checking: boolean; onJump: (e: FileValidationError) => void }) {
  const t = useT();
  const checked = CHECKED.has(file.language) && !file.readonly;
  return (
    <div className="shrink-0 border-t border-line bg-surface">
      {errors.length > 0 && (
        <div className="scroll max-h-[92px] border-b border-line py-1">
          {errors.map((e, i) => (
            <button key={i} onClick={() => onJump(e)} className="flex w-full items-baseline gap-3 px-4 py-0.5 text-left text-[12px] hover:bg-white/[.04]">
              <AlertTriangle size={12} className="shrink-0 translate-y-[2px] text-danger" />
              <span className="shrink-0 font-mono text-[11px] text-danger">{t("files.error_at", { line: e.line, col: e.column })}</span>
              <span className="min-w-0 flex-1 truncate text-text">{e.message}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex h-8 items-center gap-3 px-4 text-[12px]">
        {file.readonly ? (
          <span className="text-dim">{t("files.readonly_short")}</span>
        ) : !checked ? (
          <span className="text-dim">{t("files.no_check")}</span>
        ) : checking && !errors.length ? (
          <span className="flex items-center gap-1.5 text-dim">
            <Spinner size={11} /> {t("files.checking")}
          </span>
        ) : errors.length ? (
          <span className="flex items-center gap-1.5 font-semibold text-danger">
            <AlertTriangle size={13} /> {t(errors.length === 1 ? "files.errors_1" : "files.errors", { n: errors.length })}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-ok">
            <CheckCircle2 size={13} /> {t("files.ok")}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-dim">{file.readonly ? t("files.shortcuts_ro") : t("files.shortcuts")}</span>
      </div>
    </div>
  );
}

function ImagePreview({ scope, file }: { scope: FileScope; file: FileContent }) {
  const t = useT();
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const q = useQuery({
    queryKey: ["files", scopeKey(scope), "image", file.path, file.modified],
    queryFn: () => api.filesImage(scope, file.path),
    staleTime: Infinity,
    gcTime: 30_000,
    retry: false,
  });
  if (q.isError) return <EmptyState icon="error" title={t("files.image.failed")} text={String((q.error as { message?: string })?.message ?? "")} className="h-full" />;
  if (!q.data)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13px] text-dim">
        <Spinner size={14} /> {t("files.image.loading")}
      </div>
    );
  // Kleine Texturen (16×16) pixelgenau vergrößern, große einpassen
  const small = dims && dims.w <= 128 && dims.h <= 128;
  return (
    <div className="flex h-full flex-col">
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6"
        style={{ backgroundImage: "repeating-conic-gradient(#ffffff0a 0% 25%, transparent 0% 50%)", backgroundSize: "16px 16px" }}
      >
        <img
          src={q.data}
          alt={baseName(file.path)}
          onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className={cn("max-h-full max-w-full object-contain", small && "[image-rendering:pixelated]")}
          style={small && dims ? { width: Math.min(dims.w * 8, 512), height: "auto" } : undefined}
        />
      </div>
      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-line bg-surface px-4 text-[12px] text-dim">
        {dims && (
          <span className="tabular-nums">
            {dims.w} × {dims.h} px
          </span>
        )}
        <span>{formatBytes(file.size)}</span>
      </div>
    </div>
  );
}

function InfoCard({ file, actions }: { file: FileContent; actions: FileActions }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const entry = { name: baseName(file.path), path: file.path, is_dir: false, kind: file.kind } as const;
  const ext = extOf(file.path);
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-4 border border-line bg-surface px-8 py-8 text-center">
        <div className="grid h-14 w-14 place-items-center border border-line2 bg-surface2">
          <FileIcon entry={entry} size={26} />
        </div>
        <div className="min-w-0 max-w-full">
          <div className="truncate font-mono text-[14px] font-medium text-text" title={file.path}>
            {baseName(file.path)}
          </div>
          <div className="mt-1 text-[12.5px] text-muted">{t(`files.readonly.${file.readonly_reason ?? "binary"}`)}</div>
        </div>
        <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-left text-[12.5px]">
          <dt className="text-dim">{t("files.kind")}</dt>
          <dd className="text-right text-text">
            {t(`files.type.${file.kind}`)}
            {ext && <span className="ml-1.5 font-mono text-[11.5px] text-muted">.{ext}</span>}
          </dd>
          <dt className="text-dim">{t("files.size")}</dt>
          <dd className="text-right tabular-nums text-text">{formatBytes(file.size)}</dd>
          <dt className="text-dim">{t("files.modified_full")}</dt>
          <dd className="text-right tabular-nums text-text">{fullDate(file.modified, lang)}</dd>
        </dl>
        <Button size="sm" icon={<ExternalLink size={13} />} onClick={() => actions.reveal(file.path)}>
          {t("files.act.reveal")}
        </Button>
      </div>
    </div>
  );
}

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
