// OWNER: Frontend-Agent A. Live-Konsole und Log-Dateien einer Instanz in einem virtualisierten Viewer
// (50 000 Zeilen flüssig): Level-Filter, Suche mit Treffer-Navigation, Auto-Scroll, Zeilenumbruch,
// Kontextmenü, mclo.gs-Upload.
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { create } from "zustand";
import {
  ArrowDown,
  Stethoscope,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Copy,
  Eraser,
  FolderOpen,
  ListFilter,
  MoreHorizontal,
  RefreshCw,
  TextSelect,
  UploadCloud,
  WrapText,
  SquareTerminal,
} from "lucide-react";
import { api } from "@/lib/api";
import { qk, useGameState, useGameStore, useInstanceRuns } from "@/lib/queries";
import { isActive } from "@/lib/sessions";
import type { Instance, LogFile, LogLine } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { ContextItem, ContextMenu, ContextSeparator, DropdownCheckItem, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, EmptyState, ErrorState, IconButton, SearchInput, Select, Skeleton, Spinner, cn, toast } from "@/components/ui";
import { PageTools } from "@/features/instances/toolbar";
import { useT } from "@/i18n";
import { DiagnosisDialog } from "./Diagnosis";
import { openConsole } from "@/components/instance/actions";
import { CATS, catOf, copyText, formatLine, formatLines, levelTag, matchLogFile, parseLog, uploadToMclogs, type LevelCat } from "./logText";

// ------------------------------------------------------------------ Gewählte Quelle je Instanz

const LIVE = "live";
const useLogSource = create<{ src: Record<string, string> }>(() => ({ src: {} }));

/** Logs-Tab einer Instanz auf eine Datei stellen (z. B. Crash-Report aus dem Crash-Banner). */
export function showLogFile(instanceId: string, path: string) {
  useLogSource.setState((s) => ({ src: { ...s.src, [instanceId]: path } }));
}

/** Crash-Report (oder ersatzweise die Sitzung) zu mclo.gs hochladen. */
export async function uploadCrash(instanceId: string, crashPath: string | null) {
  try {
    if (crashPath) {
      const files = await api.instanceLogFiles(instanceId);
      const name = matchLogFile(
        files.map((f) => f.name),
        crashPath,
      );
      if (name) return void (await uploadToMclogs(await api.instanceLogRead(instanceId, name)));
    }
    const run = useGameStore.getState().states[instanceId]?.run_id;
    const lines = (run ? useGameStore.getState().logs[run] : undefined) ?? (await api.instanceLogSession(instanceId, run));
    await uploadToMclogs(formatLines(lines));
  } catch (e) {
    toast.error(e);
  }
}

function loadPref<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
}
function savePref(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* egal */
  }
}

// ------------------------------------------------------------------ Zeile

const catColor: Record<LevelCat, string> = {
  info: "text-[#d6d6dc]",
  warn: "text-warn",
  error: "text-danger",
  debug: "text-dim",
  launcher: "text-accent",
};

function highlight(text: string, q: string, current: boolean): ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const j = lower.indexOf(q, i);
    if (j === -1) break;
    if (j > i) out.push(text.slice(i, j));
    out.push(
      <mark key={k++} className={cn("text-black", current ? "bg-accent outline outline-1 outline-white" : "bg-warn/80")}>
        {text.slice(j, j + q.length)}
      </mark>,
    );
    i = j + q.length;
  }
  if (!out.length) return text;
  if (i < text.length) out.push(text.slice(i));
  return out;
}

const LogRow = memo(function LogRow({ line, q, current, wrap, plain }: { line: LogLine; q: string; current: boolean; wrap: boolean; plain: boolean }) {
  const cat = catOf(line.level);
  return (
    <div
      className={cn(
        "flex gap-3 px-4 font-mono text-[12px] leading-5",
        current && "bg-accent/10 shadow-[inset_2px_0_0_var(--accent)]",
        cat === "error" && !current && "bg-danger/[.05]",
        wrap ? "whitespace-pre-wrap break-all py-px" : "h-5 whitespace-pre",
      )}
    >
      {!plain && (
        <>
          <span className="w-[58px] shrink-0 select-none text-dim/70">{line.time ?? ""}</span>
          <span className={cn("w-[50px] shrink-0 select-none text-[10px] font-semibold tracking-[.04em]", catColor[cat], cat === "info" && "text-dim")}>
            {line.time || line.level === "launcher" ? levelTag(line.level) : ""}
          </span>
        </>
      )}
      <span className={cn("min-w-0 flex-1", catColor[cat], !wrap && "overflow-hidden text-ellipsis")}>
        {line.logger && cat !== "launcher" && <span className="text-dim">[{line.logger}] </span>}
        {highlight(line.text, q, current)}
      </span>
    </div>
  );
});

// ------------------------------------------------------------------ Viewer

/** Virtualisierte Log-Ansicht (auch für die Server-Konsole genutzt). */
export function LogViewer({
  lines,
  q,
  currentIdx,
  wrap,
  startAtTop,
  resetKey,
  jumpTo,
  onUpload,
  emptyText,
}: {
  lines: LogLine[];
  q: string;
  currentIdx: number | null;
  wrap: boolean;
  startAtTop: boolean;
  resetKey: string;
  jumpTo: { row: number } | null;
  onUpload: () => void;
  /** Text (wie bisher) oder ein eigener Leerzustand */
  emptyText: ReactNode;
}) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(!startAtTop);
  const followRef = useRef(!startAtTop);
  const menuLine = useRef<LogLine | null>(null);
  const [, force] = useState(0);

  const v = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 20,
    measureElement: wrap ? (el) => el.getBoundingClientRect().height : undefined,
  });

  // Neue Quelle: oben (Crash-Report) oder unten (Logs) beginnen
  useLayoutEffect(() => {
    followRef.current = !startAtTop;
    setFollow(!startAtTop);
    const el = scrollRef.current;
    if (el) el.scrollTop = startAtTop ? 0 : el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    v.measure();
  }, [wrap, v]);

  // Am Ende kleben, solange der Nutzer nicht hochscrollt
  const total = v.getTotalSize();
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [lines.length, total]);

  // Beim Lesen weiter oben bleibt die oberste Zeile stehen, auch wenn vorne alte Zeilen aus dem Puffer
  // fallen oder der Filter wechselt.
  const anchor = useRef<{ seq: number; offset: number } | null>(null);
  const linesRef = useRef(lines);
  useLayoutEffect(() => {
    const prev = linesRef.current;
    linesRef.current = lines;
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a || followRef.current || prev === lines || !lines.length) return;
    if (prev[0]?.seq === lines[0]?.seq && prev.length <= lines.length && !wrap) return; // nur angehängt
    let lo = 0,
      hi = lines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].seq < a.seq) lo = mid + 1;
      else hi = mid;
    }
    if (wrap) v.scrollToIndex(Math.min(lo, lines.length - 1), { align: "start" });
    else el.scrollTop = lo * 20 + a.offset;
  }, [lines, wrap, v]);

  // Suchtreffer anspringen
  useEffect(() => {
    if (!jumpTo) return;
    followRef.current = false;
    setFollow(false);
    v.scrollToIndex(jumpTo.row, { align: "center" });
  }, [jumpTo, v]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
    const top = Math.max(0, el.scrollTop - 8);
    const first = wrap ? v.getVirtualItems().find((it) => it.end > top) : undefined;
    const idx = wrap ? (first?.index ?? 0) : Math.floor(top / 20);
    const line = linesRef.current[idx];
    anchor.current = line ? { seq: line.seq, offset: wrap ? 0 : el.scrollTop - idx * 20 } : null;
    if (atBottom !== followRef.current) {
      followRef.current = atBottom;
      setFollow(atBottom);
    }
  }, [wrap, v]);

  const jumpDown = () => {
    followRef.current = true;
    setFollow(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const selectAll = () => {
    const el = innerRef.current;
    const sel = window.getSelection();
    if (!el || !sel) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(r);
  };

  // Dateien ohne Zeitstempel (Crash-Reports) ohne Zeit-/Level-Spalten zeigen
  const plain = useMemo(() => {
    for (let i = 0; i < Math.min(lines.length, 300); i++) if (lines[i].time || lines[i].level === "launcher") return false;
    return lines.length > 0;
  }, [lines]);

  const selection = typeof window !== "undefined" ? (window.getSelection()?.toString() ?? "") : "";

  return (
    <div className="relative min-h-0 flex-1">
      <ContextMenu
        content={
          <>
            <ContextItem icon={<Copy size={14} />} disabled={!menuLine.current} onSelect={() => menuLine.current && copyText(formatLine(menuLine.current))}>
              {t("logs.copy_line")}
            </ContextItem>
            <ContextItem icon={<TextSelect size={14} />} disabled={!selection} shortcut="Strg+C" onSelect={() => copyText(selection)}>
              {t("logs.copy_selection")}
            </ContextItem>
            <ContextItem icon={<ClipboardCopy size={14} />} disabled={!lines.length} onSelect={() => copyText(formatLines(lines))}>
              {t("logs.copy_all")}
            </ContextItem>
            <ContextSeparator />
            <ContextItem icon={<UploadCloud size={14} />} disabled={!lines.length} onSelect={onUpload}>
              {t("logs.upload")}
            </ContextItem>
          </>
        }
      >
        <div
          ref={scrollRef}
          onScroll={onScroll}
          tabIndex={0}
          onContextMenu={(e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
            menuLine.current = row ? (lines[Number(row.dataset.index)] ?? null) : null;
            force((n) => n + 1);
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
              e.preventDefault();
              selectAll();
            } else if (e.key === "End") {
              e.preventDefault();
              jumpDown();
            } else if (e.key === "Home") {
              e.preventDefault();
              const el = scrollRef.current;
              if (el) el.scrollTop = 0;
            }
          }}
          className={cn("scroll h-full bg-bg py-2 outline-none", "focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]")}
        >
          {lines.length === 0 ? (
            typeof emptyText === "string" ? (
              <div className="grid h-full place-items-center px-6 text-center text-[13px] text-dim">{emptyText}</div>
            ) : (
              <div className="grid h-full place-items-center px-6">{emptyText}</div>
            )
          ) : (
            <div ref={innerRef} className="selectable relative w-full" style={{ height: total }}>
              {v.getVirtualItems().map((row) => (
                <div
                  key={row.key}
                  data-index={row.index}
                  ref={wrap ? v.measureElement : undefined}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <LogRow line={lines[row.index]} q={q} current={currentIdx === row.index} wrap={wrap} plain={plain} />
                </div>
              ))}
            </div>
          )}
        </div>
      </ContextMenu>
      {!follow && lines.length > 0 && (
        <button
          onClick={jumpDown}
          className="absolute bottom-4 right-6 flex h-9 items-center gap-2 rounded-ctl bg-surface3 px-3.5 text-[13px] font-semibold text-text shadow-e2 transition-colors duration-150 animate-pop-in hover:bg-accent hover:text-[var(--on-accent)]"
        >
          <ArrowDown size={13} />
          {t("logs.jump_bottom")}
        </button>
      )}
    </div>
  );
}

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
  const [curSeq, setCurSeq] = useState<number | null>(null);
  const [jump, setJump] = useState<{ row: number } | null>(null);
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

  const dq = useDeferredValue(query.trim().toLowerCase());
  const matches = useMemo(() => {
    if (!dq) return [] as number[];
    const m: number[] = [];
    for (let i = 0; i < lines.length; i++) if (lines[i].text.toLowerCase().includes(dq)) m.push(i);
    return m;
  }, [lines, dq]);
  // Aktueller Treffer über die Zeilennummer (seq) – Positionen verschieben sich, wenn der Puffer vorne kürzt
  const curPos = useMemo(() => (curSeq === null ? -1 : matches.findIndex((i) => lines[i].seq === curSeq)), [matches, lines, curSeq]);
  const curIdx = curPos >= 0 ? matches[curPos] : null;

  const go = (dir: 1 | -1) => {
    if (!matches.length) return;
    const from = curPos >= 0 ? curPos : dir === 1 ? -1 : 0;
    const next = (from + dir + matches.length) % matches.length;
    setCurSeq(lines[matches[next]].seq);
    setJump({ row: matches[next] });
  };
  useEffect(() => {
    if (matches.length) {
      setCurSeq(lines[matches[0]].seq);
      setJump({ row: matches[0] });
    } else setCurSeq(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, source]);

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
      icon={<SquareTerminal size={30} strokeWidth={1.6} />}
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
          {dq && (
            <>
              <span className="min-w-[52px] shrink-0 text-center font-mono text-[11px] text-dim">
                {matches.length ? `${curPos >= 0 ? curPos + 1 : "–"}/${matches.length.toLocaleString()}` : "0/0"}
              </span>
              <IconButton label={t("logs.prev")} variant="ghost" disabled={!matches.length} onClick={() => go(-1)}>
                <ChevronUp size={15} />
              </IconButton>
              <IconButton label={t("logs.next")} variant="ghost" disabled={!matches.length} onClick={() => go(1)}>
                <ChevronDown size={15} />
              </IconButton>
            </>
          )}
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
        <DropdownMenu
          trigger={
            <IconButton label={t("logs.levels")} tip variant="ghost" badge={CATS.length - cats.length || null} badgeTone="muted" className="data-[state=open]:bg-white/[.07]">
              <ListFilter size={16} />
            </IconButton>
          }
        >
          <DropdownLabel>{t("logs.levels")}</DropdownLabel>
          {CATS.map((c) => (
            <DropdownCheckItem key={c} checked={cats.includes(c)} onCheckedChange={() => toggleCat(c)}>
              <span className="flex w-full items-center gap-2">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-dot",
                    c === "info" ? "bg-text" : c === "warn" ? "bg-warn" : c === "error" ? "bg-danger" : c === "debug" ? "bg-dim" : "bg-accent",
                  )}
                />
                <span className="flex-1">{t(`logs.level.${c}`)}</span>
                <span className="tabular-nums text-dim">{counts[c].toLocaleString()}</span>
              </span>
            </DropdownCheckItem>
          ))}
        </DropdownMenu>
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
        <DropdownMenu
          trigger={
            <IconButton label={t("common.more")} tip variant="ghost" className="data-[state=open]:bg-white/[.07]">
              <MoreHorizontal size={16} />
            </IconButton>
          }
        >
          <DropdownItem icon={<Copy size={14} />} disabled={!lines.length} onSelect={() => copyText(formatLines(lines))}>
            {t("logs.copy_all")}
          </DropdownItem>
          {isFile ? (
            <DropdownItem icon={<RefreshCw size={14} />} onSelect={() => void file.refetch()}>
              {t("logs.reload")}
            </DropdownItem>
          ) : (
            <DropdownItem icon={<Eraser size={14} />} disabled={!liveLines.length} onSelect={() => runId && useGameStore.getState().setLogs(runId, [])}>
              {t("logs.clear")}
            </DropdownItem>
          )}
          <DropdownSeparator />
          <DropdownItem icon={<FolderOpen size={14} />} onSelect={() => api.instanceOpenFolder(id, crash ? "crash-reports" : "logs").catch((e) => toast.error(e))}>
            {t("common.open_folder")}
          </DropdownItem>
        </DropdownMenu>
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
