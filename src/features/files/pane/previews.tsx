import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import type { FileContent, FileScope } from "@/lib/types";
import { formatBytes } from "@/lib/format";
import { Button, EmptyState, Spinner, cn } from "@/components/ui";
import { useLang, useT } from "@/i18n";
import type { FileActions } from "../FileTree";
import { FileIcon, baseName, extOf, fullDate, scopeKey } from "../util";

export function ImagePreview({ scope, file }: { scope: FileScope; file: FileContent }) {
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

export function InfoCard({ file, actions }: { file: FileContent; actions: FileActions }) {
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
