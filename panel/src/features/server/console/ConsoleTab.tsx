import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, Search, Send } from "lucide-react";
import type { LogLine, ServerView } from "@/api/types";
import { useAgent, useLog } from "@/app/agent";
import { useT } from "@/i18n";
import { Button, Input, cn, toast } from "@/components/ui";

const QUICK = ["list", "say Hallo zusammen!", "time set day", "weather clear", "help"];

function lineClass(l: LogLine): string {
  if (l.level === "error" || l.level === "fatal" || l.level === "stderr") return "text-[var(--syn-err)]";
  if (l.level === "warn") return "text-[var(--syn-warn)]";
  if (l.level === "launcher") return "text-[#a99bff]";
  return "text-[#d9d9e0]";
}

export function ConsoleTab({ server: s }: { server: ServerView }) {
  const t = useT();
  const { api, can } = useAgent();
  const lines = useLog(s.id);
  const [cmd, setCmd] = useState("");
  const [filter, setFilter] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIndex, setHIndex] = useState(-1);
  const [stick, setStick] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const running = s.status?.state === "running";
  const send = useMutation({
    mutationFn: (c: string) => api.command(s.id, c),
    onError: (e) => toast.error(e),
  });
  const shown = useMemo(() => (filter ? lines.filter((l) => l.text.toLowerCase().includes(filter.toLowerCase())) : lines), [lines, filter]);

  useLayoutEffect(() => {
    if (stick && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown, stick]);
  useEffect(() => setStick(true), [s.id]);

  const submit = () => {
    const c = cmd.trim();
    if (!c) return;
    send.mutate(c.replace(/^\//, ""));
    setHistory((h) => [c, ...h.filter((x) => x !== c)].slice(0, 50));
    setHIndex(-1);
    setCmd("");
    setStick(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("console.filter")} className="pl-9" />
        </div>
        <span className="ml-auto text-meta text-dim">{t("console.lines", { n: lines.length })}</span>
      </div>
      <div className="relative">
        <div
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget;
            setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 30);
          }}
          className="h-[52vh] min-h-[320px] overflow-y-auto rounded-card bg-[var(--console-bg)] p-4 font-mono text-[12.5px] leading-[1.6] shadow-[inset_0_0_0_1px_var(--line-1)]"
          role="log"
          aria-live="polite"
        >
          {shown.length === 0 && <div className="text-[var(--syn-dim)]">{running ? t("console.waiting") : t("console.empty")}</div>}
          {shown.map((l) => (
            <div key={l.seq} className={cn("console-line", lineClass(l))}>
              {l.time && <span className="mr-2 text-[var(--syn-dim)]">{l.time}</span>}
              {l.text}
            </div>
          ))}
        </div>
        {!stick && (
          <button
            onClick={() => setStick(true)}
            className="absolute right-4 bottom-4 flex items-center gap-1.5 rounded-pill bg-brand px-3 py-1.5 text-meta font-semibold text-[var(--ui-on-accent)] shadow-e2"
          >
            <ArrowDown size={14} />
            {t("console.jump")}
          </button>
        )}
      </div>
      {can("servers.control") && (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="relative flex-1">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-accent">/</span>
              <Input
                value={cmd}
                disabled={!running}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" && history.length) {
                    e.preventDefault();
                    const i = Math.min(history.length - 1, hIndex + 1);
                    setHIndex(i);
                    setCmd(history[i]);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    const i = hIndex - 1;
                    setHIndex(Math.max(-1, i));
                    setCmd(i < 0 ? "" : history[i]);
                  }
                }}
                placeholder={running ? t("console.placeholder") : t("console.not_running")}
                className="h-11 pl-7 font-mono"
                aria-label={t("console.command")}
              />
            </div>
            <Button type="submit" variant="primary" size="lg" disabled={!running || !cmd.trim()} icon={<Send size={15} />}>
              {t("console.send")}
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-meta text-dim">{t("console.quick")}</span>
            {QUICK.map((q) => (
              <button key={q} disabled={!running} onClick={() => send.mutate(q)} className="rounded-pill bg-surface2 px-3 py-1 font-mono text-[12px] text-muted hover:bg-surface3 hover:text-text disabled:opacity-40">
                /{q}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
