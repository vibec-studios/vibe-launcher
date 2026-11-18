// CurseForge-Dateien ohne Drittanbieter-Freigabe: müssen im Browser geladen werden. Vibe übernimmt sie automatisch
// aus dem Download-Ordner (nur bei passendem Hash) – nach einem Klick auf „Herunterladen“ einige Minuten lang,
// oder sofort über „Ich habe sie heruntergeladen – suchen“. Popover in der Hinweiszeile der Instanzseite.
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FolderOpen, RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton, Spinner, Tag, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { kindFolder, openExternal } from "@/components/content/util";
import { setWatching, useWatching } from "@/components/content/install";

export function useMissingDownloads(instanceId: string) {
  // Schlüssel unter ["content", id] -> EventBridge invalidiert bei content://changed
  return useQuery({ queryKey: ["content", instanceId, "missing"], queryFn: () => api.contentMissing(instanceId), staleTime: 60_000, retry: 0 });
}

/** Sekundentakt, solange beobachtet wird (für die Anzeige). */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(h);
  }, [active]);
  return now;
}

export function MissingPanel({ instanceId, onDismissed }: { instanceId: string; onDismissed?: () => void }) {
  const t = useT();
  const q = useMissingDownloads(instanceId);
  const items = q.data ?? [];
  // Ordner der meisten fehlenden Dateien (fast immer mods/)
  const kind = items[0]?.kind ?? "mod";
  const until = useWatching(instanceId);
  const now = useNow(!!until);
  const watching = !!until && until > now && items.length > 0;
  const [scanning, setScanning] = useState(false);

  const recheck = () => queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
  const dismiss = () =>
    api
      .contentMissingDismiss(instanceId)
      .then(() => {
        queryClient.setQueryData(["content", instanceId, "missing"], []);
        onDismissed?.();
      })
      .catch((e) => toast.error(e));

  const download = (url: string) => {
    void openExternal(url);
    api
      .contentMissingWatch(instanceId)
      .then((u) => setWatching(instanceId, u))
      .catch(() => {});
  };

  const search = () => {
    setScanning(true);
    api
      .contentMissingScan(instanceId)
      .then((r) => {
        setWatching(instanceId, r.watching_until);
        queryClient.setQueryData(["content", instanceId, "missing"], r.remaining);
        if (r.found.length) toast.success(r.found.length === 1 ? t("missing.found_1") : t("missing.found", { n: r.found.length }), r.found.map((f) => f.project_name).join(", "));
        else if (!r.folder) toast.info(t("missing.not_found"), t("missing.no_folder"));
        else toast.info(t("missing.not_found"), t("missing.not_found_text", { folder: r.folder }));
        if (!r.remaining.length) onDismissed?.();
      })
      .catch((e) => toast.error(e))
      .finally(() => setScanning(false));
  };

  return (
    <div>
      <div className="border-b border-line px-4 py-3">
        <div className="text-[13.5px] font-semibold text-text">{t("missing.title", { n: items.length })}</div>
        <div className="mt-0.5 text-meta text-muted">{t("missing.text")}</div>
      </div>
      <div className="scroll max-h-[240px] px-4 py-1">
        {items.map((m) => (
          <div key={`${m.kind}/${m.file_name}`} className="flex h-10 items-center gap-3 text-[12.5px]">
            <span className="min-w-0 flex-1" title={m.file_name}>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium text-text">{m.project_name}</span>
                {m.is_update && <Tag className="shrink-0">{t("missing.update")}</Tag>}
              </span>
              <span className="block truncate text-[11.5px] leading-tight text-dim">{m.version_number ?? m.file_name}</span>
            </span>
            <button
              onClick={() => download(m.page_url)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-ctl text-[13px] font-semibold text-brand hover:underline"
            >
              {t("missing.download")}
              <ExternalLink size={11} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-3 py-2">
        <Button size="sm" variant="ghost" icon={<Search size={13} />} loading={scanning} onClick={search}>
          {t("missing.search")}
        </Button>
        {watching && (
          <span className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-dim" title={t("missing.watching_tip")}>
            <Spinner size={10} />
            <span className="truncate">{t("missing.watching")}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-line px-3 py-2">
        <IconButton
          label={t("common.open_folder")}
          tip
          tipSide="top"
          variant="ghost"
          size="sm"
          onClick={() => api.instanceOpenFolder(instanceId, kindFolder[kind]).catch((e) => toast.error(e))}
        >
          <FolderOpen size={15} />
        </IconButton>
        <IconButton label={t("missing.recheck")} tip tipSide="top" variant="ghost" size="sm" disabled={q.isFetching} onClick={recheck}>
          {q.isFetching ? <Spinner size={12} /> : <RefreshCw size={15} />}
        </IconButton>
        <div className="flex-1" />
        <Button size="sm" variant="subtle" onClick={dismiss}>
          {t("missing.dismiss")}
        </Button>
      </div>
    </div>
  );
}
