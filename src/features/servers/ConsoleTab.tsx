// Server-Konsole: virtualisierte Live-Ausgabe (gleicher Viewer wie das Spiel-Log), Suche,
// Befehlseingabe mit Verlauf (Pfeil hoch/runter) und Schnellknöpfen.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, CornerDownLeft, Eraser, FolderOpen, Save, UploadCloud, Users, WrapText } from "lucide-react";
import { api } from "@/lib/api";
import { useServerStatus, useServerStore } from "@/lib/queries";
import type { LogLine, Server } from "@/lib/types";
import { Button, IconButton, SearchInput, Tooltip, cn, toast } from "@/components/ui";
import { LogViewer } from "@/features/logs/LogsTab";
import { copyText, formatLines, uploadToMclogs } from "@/features/logs/logText";
import { useT } from "@/i18n";

const EMPTY: LogLine[] = [];
/** Befehlsverlauf je Server (bleibt beim Tab-Wechsel erhalten) */
const history = new Map<string, string[]>();
const MAX_HISTORY = 100;

function loadWrap(): boolean {
  try {
    return localStorage.getItem("vl.srvlog.wrap") === "1";
  } catch {
    return false;
  }
}

export function ConsoleTab({ server }: { server: Server }) {
  const t = useT();
  const id = server.id;
  const st = useServerStatus(id);
  const lines = useServerStore((s) => s.logs[id] ?? EMPTY);
  const running = st?.state === "running";
  const canSend = running && !st?.detached;
  const [wrap, setWrapState] = useState(loadWrap);
  const [query, setQuery] = useState("");
  const [curSeq, setCurSeq] = useState<number | null>(null);
  const [jump, setJump] = useState<{ row: number } | null>(null);
  const [cmd, setCmd] = useState("");
  const [sending, setSending] = useState(false);
  const histPos = useRef<number | null>(null);
  const draft = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);

  const setWrap = (w: boolean) => {
    setWrapState(w);
    try {
      localStorage.setItem("vl.srvlog.wrap", w ? "1" : "0");
    } catch {
      /* egal */
    }
  };

  // Puffer beim Öffnen nachladen, danach kommen Zeilen per server://log
  useEffect(() => {
    let dead = false;
    api
      .serverLog(id)
      .then((l) => {
        if (dead) return;
        const cur = useServerStore.getState().logs[id];
        if (!cur || cur.length < l.length) useServerStore.getState().setLogs(id, l);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [id]);

  // Suche
  const dq = useDeferredValue(query.trim().toLowerCase());
  const matches = useMemo(() => {
    if (!dq) return [] as number[];
    const m: number[] = [];
    for (let i = 0; i < lines.length; i++) if (lines[i].text.toLowerCase().includes(dq)) m.push(i);
    return m;
  }, [lines, dq]);
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
      setCurSeq(lines[matches[matches.length - 1]].seq);
      setJump({ row: matches[matches.length - 1] });
    } else setCurSeq(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const send = async (raw: string) => {
    const c = raw.trim().replace(/^\/+/, "");
    if (!c || !canSend) return;
    const h = history.get(id) ?? [];
    if (h[h.length - 1] !== c) h.push(c);
    if (h.length > MAX_HISTORY) h.shift();
    history.set(id, h);
    histPos.current = null;
    setSending(true);
    try {
      await api.serverCommand(id, c);
      if (raw === cmd) setCmd("");
    } catch (e) {
      toast.error(e, t("srv.console.failed"));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const h = history.get(id) ?? [];
    if (e.key === "Enter") {
      e.preventDefault();
      send(cmd);
    } else if (e.key === "ArrowUp") {
      if (!h.length) return;
      e.preventDefault();
      if (histPos.current === null) {
        draft.current = cmd;
        histPos.current = h.length - 1;
      } else histPos.current = Math.max(0, histPos.current - 1);
      setCmd(h[histPos.current]);
    } else if (e.key === "ArrowDown") {
      if (histPos.current === null) return;
      e.preventDefault();
      if (histPos.current >= h.length - 1) {
        histPos.current = null;
        setCmd(draft.current);
      } else {
        histPos.current += 1;
        setCmd(h[histPos.current]);
      }
    }
  };

  const emptyText = st?.detached ? t("srv.console.detached") : running || st?.state === "starting" ? t("logs.waiting") : t("srv.console.empty");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-black px-6">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t("logs.search")}
            className="min-w-[140px] max-w-[300px] flex-1 [&_input]:h-8"
            data-allow-find="1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                go(e.shiftKey ? 1 : -1);
              }
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
          />
          {dq && (
            <>
              <span className="min-w-[56px] shrink-0 text-center font-mono text-[11px] text-dim">
                {matches.length ? `${curPos >= 0 ? curPos + 1 : "–"}/${matches.length.toLocaleString()}` : "0/0"}
              </span>
              <IconButton label={t("logs.prev")} size="sm" disabled={!matches.length} onClick={() => go(-1)}>
                <ChevronUp size={15} />
              </IconButton>
              <IconButton label={t("logs.next")} size="sm" disabled={!matches.length} onClick={() => go(1)}>
                <ChevronDown size={15} />
              </IconButton>
            </>
          )}
        </div>
        <span className="mr-1 flex items-center gap-2 text-[12px] text-dim">
          {running && (
            <span className="flex items-center gap-1.5 text-ok">
              <span className="h-1.5 w-1.5 animate-pulse bg-ok" />
              LIVE
            </span>
          )}
          {t("logs.lines", { n: lines.length.toLocaleString() })}
        </span>
        <Tooltip content={t("logs.wrap")}>
          <IconButton label={t("logs.wrap")} size="sm" active={wrap} onClick={() => setWrap(!wrap)}>
            <WrapText size={15} />
          </IconButton>
        </Tooltip>
        <Tooltip content={t("logs.copy_all")}>
          <IconButton label={t("logs.copy_all")} size="sm" disabled={!lines.length} onClick={() => copyText(formatLines(lines))}>
            <Copy size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content={t("logs.clear")}>
          <IconButton label={t("logs.clear")} size="sm" disabled={!lines.length} onClick={() => useServerStore.getState().setLogs(id, [])}>
            <Eraser size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content={t("srv.console.logs_folder")}>
          <IconButton label={t("srv.console.logs_folder")} size="sm" onClick={() => api.serverOpenFolder(id, "logs").catch((e) => toast.error(e))}>
            <FolderOpen size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content={t("logs.upload")}>
          <IconButton label={t("logs.upload")} size="sm" disabled={!lines.length} onClick={() => uploadToMclogs(formatLines(lines))}>
            <UploadCloud size={14} />
          </IconButton>
        </Tooltip>
      </div>

      <LogViewer
        lines={lines}
        q={dq}
        currentIdx={curIdx}
        wrap={wrap}
        startAtTop={false}
        resetKey={id}
        jumpTo={jump}
        onUpload={() => uploadToMclogs(formatLines(lines))}
        emptyText={emptyText}
      />

      <div className="flex h-14 shrink-0 items-center gap-2 border-t border-line bg-black px-6">
        <div
          className={cn(
            "flex h-9 min-w-0 flex-1 items-center border border-line2 bg-surface transition-colors duration-150 focus-within:border-accent",
            !canSend && "opacity-50",
          )}
        >
          <span className="select-none pl-3 pr-1 font-mono text-[13px] text-accent">&gt;</span>
          <input
            ref={inputRef}
            value={cmd}
            disabled={!canSend}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setCmd(e.target.value);
              histPos.current = null;
            }}
            onKeyDown={onKey}
            placeholder={canSend ? t("srv.console.placeholder") : st?.detached ? t("srv.console.detached_short") : t("srv.console.not_running")}
            aria-label={t("srv.console.placeholder")}
            className="h-full min-w-0 flex-1 bg-transparent px-1 font-mono text-[13px] text-text outline-none placeholder:text-dim"
          />
          <button
            aria-label={t("srv.console.send")}
            disabled={!canSend || !cmd.trim() || sending}
            onClick={() => send(cmd)}
            className="grid h-full w-9 place-items-center border-l border-line text-muted transition-colors duration-100 hover:bg-surface3 hover:text-white disabled:opacity-40"
          >
            <CornerDownLeft size={14} />
          </button>
        </div>
        <Button size="sm" icon={<Users size={13} />} disabled={!canSend} onClick={() => send("list")}>
          list
        </Button>
        <Button size="sm" icon={<Save size={13} />} disabled={!canSend} onClick={() => send("save-all")}>
          save-all
        </Button>
      </div>
    </div>
  );
}
