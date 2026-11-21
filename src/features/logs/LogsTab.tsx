// OWNER: Frontend-Agent A. Live-Konsole und Log-Dateien einer Instanz in einem virtualisierten Viewer
// (50 000 Zeilen flüssig): Level-Filter, Suche mit Treffer-Navigation, Auto-Scroll, Zeilenumbruch,
// Kontextmenü, mclo.gs-Upload.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Stethoscope, UploadCloud, WrapText, SquareTerminal } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useGameState, useGameStore, useInstanceRuns } from "@/lib/queries";
import { isActive } from "@/lib/sessions";
import type { Instance, LogFile, LogLine } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { EmptyState, ErrorState, IconButton, SearchInput, Select, Skeleton, Spinner } from "@/components/ui";
import { PageTools } from "@/features/instances/toolbar";
import { useT } from "@/i18n";
import { DiagnosisDialog } from "./Diagnosis";
import { openConsole } from "@/components/instance/actions";
import { CATS, catOf, formatLines, matchLogFile, parseLog, uploadToMclogs, type LevelCat } from "./logText";
import { LIVE, loadPref, savePref, useLogSource } from "./source";
import { LevelFilterMenu } from "./components/LevelFilterMenu";
import { LogsMoreMenu } from "./components/LogsMoreMenu";
import { LogViewer } from "./components/LogViewer";
import { SearchNav } from "./components/SearchNav";
import { useLogSearch } from "./hooks/useLogSearch";

export { showLogFile, uploadCrash } from "./source";
export { LogViewer } from "./components/LogViewer";

// ------------------------------------------------------------------ Tab

const EMPTY: LogLine[] = [];

export function LogsTab({ instance }: { instance: Instance }) {
  const t = useT();
  const id = instance.id;
  const primary = useGameState(id);
  const runs = useInstanceRuns(id);
  const multi = runs.length > 1;
  const requested = useLogSource((s) => s.src[id] ?? LIVE);
  const reqLive = requested === LIVE || requested.startsWith("live:");
  const pickedRun = requested.startsWith("live:") ? runs.find((r) => r.run_id === requested.slice(5)) : undefined;
  const game = pickedRun ?? primary;
  const runId = game?.run_id;
  const running = isActive(game);
  const liveLines = useGameStore((s) => (runId ? s.logs[runId] : undefined) ?? EMPTY);
  const [wrap, setWrapState] = useState<boolean>(() => loadPref("vl.logs.wrap", false));
  const [diagOpen, setDiagOpen] = useState(false);
  const [cats, setCatsState] = useState<LevelCat[]>(() => loadPref("vl.logs.cats", CATS));
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);

  const setWrap = (w: boolean) => {
    setWrapState(w);
    savePref("vl.logs.wrap", w);
  };
  const toggleCat = (c: LevelCat) => {
    const next = cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c];
    setCatsState(next);
    savePref("vl.logs.cats", next);
  };

  // Sitzungspuffer einmalig nachladen (falls der Tab nach dem Start geöffnet wird)
  useEffect(() => {
    if (!runId) return;
    let dead = false;
    api
      .instanceLogSession(id, runId)
      .then((lines) => {
        if (dead) return;
        useGameStore.getState().hydrateLogs(runId, lines);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [id, runId]);

  // Dateiliste; nach Spielende neu laden
  const files = useQuery({ queryKey: qk.logFiles(id), queryFn: () => api.instanceLogFiles(id), staleTime: 15_000 });
  const stopped = game?.state === "stopped";
  useEffect(() => {
    if (stopped) files.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopped, game?.started_at]);

  const fileNames = useMemo(() => (files.data ?? []).map((f) => f.name), [files.data]);
  const source = reqLive ? LIVE : (matchLogFile(fileNames, requested) ?? (files.data ? LIVE : requested));
  const fileInfo: LogFile | undefined = files.data?.find((f) => f.name === source);
  const isFile = source !== LIVE;

  const file = useQuery({
    queryKey: ["log-file", id, source],
    queryFn: () => api.instanceLogRead(id, source),
    enabled: isFile && !!fileInfo,
    staleTime: 10_000,
    placeholderData: undefined,
  });
  const fileLines = useMemo(() => (file.data !== undefined ? parseLog(file.data, fileInfo?.kind === "crash") : EMPTY), [file.data, fileInfo?.kind]);
  const all = isFile ? fileLines : liveLines;

  // Filtern + Zählen in einem Durchlauf
  const { lines, counts } = useMemo(() => {
    const counts: Record<LevelCat, number> = { info: 0, warn: 0, error: 0, debug: 0, launcher: 0 };
    const on = new Set(cats);
    const allOn = on.size === CATS.length;
    const out: LogLine[] = allOn ? all : [];
    for (const l of all) {
      const c = catOf(l.level);
      counts[c]++;
      if (!allOn && on.has(c)) out.push(l);
    }
    return { lines: out, counts };
  }, [all, cats]);

  const { dq, matches, curPos, curIdx, go, jump } = useLogSearch(lines, query, source);

  // Strg+F fokussiert die Suche
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        const input = searchRef.current?.querySelector("input");
        input?.focus();
        input?.select();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const [uploading, setUploading] = useState(false);
  const upload = async () => {
    setUploading(true);
    await uploadToMclogs(isFile ? (file.data ?? "") : formatLines(all));
    setUploading(false);
  };

  const liveOptions = multi
    ? runs.map((r) => ({
        value: `live:${r.run_id}`,
        label: `${t("logs.live")} · ${t("sess.session", { n: r.slot })}`,
        hint: isActive(r) ? `● ${r.account_name ?? "live"}` : t("logs.session"),
      }))
    : [{ value: LIVE, label: t("logs.live"), hint: running ? "● live" : t("logs.session") }];
  const selectValue = source === LIVE && multi && runId ? `live:${runId}` : source;
  const sourceOptions = [
    ...liveOptions,
    ...(files.data ?? []).map((f) => ({
      value: f.name,
      label: f.kind === "crash" ? `${t("logs.crash")} · ${f.name.split("/").pop()}` : (f.name.split("/").pop() ?? f.name),
      hint: formatBytes(f.size),
    })),
  ];
  // Datei aus dem Crash-Banner, die (noch) nicht in der Liste ist
  if (isFile && !fileInfo) sourceOptions.push({ value: source, label: source.split(/[\\/]/).pop() ?? source, hint: "" });

  const crash = fileInfo?.kind === "crash";
  // Live-Konsole ohne laufendes Spiel: richtiger Leerzustand mit Hinweis auf ältere Logs statt nur einer Textzeile
  const emptyText: ReactNode = isFile ? (
    t("logs.file_empty")
  ) : running ? (
    t("logs.waiting")
  ) : (
    <EmptyState
      className="py-10"
      icon="terminal"
      title={t("logs.empty_live.title")}
      text={files.data?.length ? t("logs.empty_live.text_files") : t("logs.empty_live.text")}
    />
  );

  return (
    <div className="flex h-full flex-col">
      {/* Eine Werkzeugzeile: Quelle + Suche links; Stufen-Filter, Diagnose, Umbruch, Hochladen, Mehr rechts */}
      <PageTools>
        <div className="w-[210px] shrink-0 max-[1100px]:w-[170px]">
          <Select
            variant="ghost"
            value={selectValue}
            onChange={(v) => useLogSource.setState((s) => ({ src: { ...s.src, [id]: v } }))}
            options={sourceOptions}
          />
        </div>
        <div ref={searchRef} className="flex min-w-0 flex-1 items-center gap-1">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t("logs.search")}
            className="w-[240px] min-w-[120px] shrink"
            data-allow-find="1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                go(e.shiftKey ? -1 : 1);
              }
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
          />
          {dq && <SearchNav matches={matches} curPos={curPos} go={go} />}
          <span className="ml-1 flex min-w-0 items-center gap-2 truncate text-[12px] text-dim">
            {!isFile && running && (
              <span className="flex items-center gap-1.5 font-semibold text-ok">
                <span className="h-1.5 w-1.5 animate-pulse rounded-dot bg-ok" />
                LIVE
              </span>
            )}
            {isFile && fileInfo && <span className="truncate">{formatRelative(fileInfo.modified)}</span>}
            {lines.length > 0 && <span className="truncate">{t("logs.lines", { n: lines.length.toLocaleString() })}</span>}
          </span>
        </div>
        <LevelFilterMenu cats={cats} counts={counts} toggleCat={toggleCat} />
        <IconButton label={t("diag.open")} tip variant="ghost" data-tour="logs-diagnose" onClick={() => setDiagOpen(true)}>
          <Stethoscope size={16} />
        </IconButton>
        <IconButton label={t("sess.console")} tip variant="ghost" onClick={() => openConsole(runId)}>
          <SquareTerminal size={16} />
        </IconButton>
        <IconButton label={t("logs.wrap")} tip variant="ghost" active={wrap} onClick={() => setWrap(!wrap)}>
          <WrapText size={16} />
        </IconButton>
        <IconButton label={t("logs.upload")} tip variant="ghost" disabled={!all.length || uploading} onClick={upload}>
          {uploading ? <Spinner size={13} /> : <UploadCloud size={16} />}
        </IconButton>
        <LogsMoreMenu id={id} runId={runId} lines={lines} liveLines={liveLines} isFile={isFile} crash={crash} reload={() => void file.refetch()} />
      </PageTools>

      {isFile && file.isError ? (
        <ErrorState error={file.error} onRetry={() => file.refetch()} className="flex-1" />
      ) : isFile && (file.isLoading || (!fileInfo && !files.data)) ? (
        <div className="flex flex-1 flex-col gap-1.5 bg-bg px-4 py-3">
          {Array.from({ length: 14 }, (_, i) => (
            <Skeleton key={i} className="h-3" style={{ width: `${30 + ((i * 37) % 60)}%` }} />
          ))}
        </div>
      ) : (
        <LogViewer
          lines={lines}
          q={dq}
          currentIdx={curIdx}
          wrap={wrap}
          startAtTop={crash}
          resetKey={`${source}`}
          jumpTo={jump}
          onUpload={upload}
          emptyText={emptyText}
        />
      )}
      <DiagnosisDialog
        inst={instance}
        crashReport={game?.crash_report ?? null}
        exitCode={game?.state === "stopped" ? (game.exit_code ?? null) : null}
        open={diagOpen}
        onOpenChange={setDiagOpen}
      />
    </div>
  );
}
