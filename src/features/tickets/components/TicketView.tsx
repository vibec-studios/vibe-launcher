import { useEffect, useRef, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import type { TicketRequest } from "@/lib/types";
import { ErrorState, IconButton, Spinner, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import { copyText } from "@/features/files/util";
import { ticketErrorText } from "../call";
import { presetLogs } from "../logic";
import { useTicketDetail } from "../useTicketDetail";
import { AttachDialog, type AttachPreset } from "./AttachDialog";
import { Composer } from "./Composer";
import { RequestCard } from "./RequestCard";
import { KindIcon, StatusBadge } from "./StatusBadge";
import { Timeline } from "./Timeline";

function CopyTicket({ ticket }: { ticket: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip content={copied ? t("fb.done.copied") : t("fb.done.copy")} side="bottom">
      <IconButton
        label={t("fb.done.copy")}
        size="sm"
        variant="ghost"
        onClick={async () => {
          await copyText(ticket);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
      </IconButton>
    </Tooltip>
  );
}

export function TicketView({ ticket }: { ticket: string }) {
  const t = useT();
  const q = useTicketDetail(ticket);
  const [preset, setPreset] = useState<AttachPreset | null>(null);
  const [fulfills, setFulfills] = useState<string[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const d = q.data;
  const count = d?.messages.length ?? 0;

  useEffect(() => setFulfills([]), [ticket]);
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [count, ticket]);

  if (q.isLoading) return <Spinner size={18} className="m-auto text-muted" />;
  if (!d) return <ErrorState error={ticketErrorText(q.error)} onRetry={() => void q.refetch()} className="m-auto" />;

  const open = d.requests.filter((r) => r.status === "open");
  const fulfill = (r: TicketRequest) => {
    if (r.type === "text") {
      setFulfills([...new Set([...fulfills, r.id])]);
      input.current?.focus();
      return;
    }
    setPreset({ logs: presetLogs(r), fulfills: [r.id] });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <KindIcon kind={d.kind} size={16} className="text-dim" />
        <span className="font-mono text-[15px] font-semibold text-text">{d.ticket}</span>
        <CopyTicket ticket={d.ticket} />
        <StatusBadge status={d.status} />
        <span className="flex-1" />
        <span className="hidden text-[12px] text-dim sm:inline">
          {t(`tk.kind.${d.kind}`)} · {d.app} {d.version}
        </span>
        <IconButton label={t("tk.reload")} tip size="sm" variant="ghost" onClick={() => void q.refetch()} disabled={q.isFetching}>
          <RefreshCw size={14} className={q.isFetching ? "animate-spin" : undefined} />
        </IconButton>
      </div>
      {open.length > 0 && d.canReply && (
        <div className="flex flex-col gap-1.5 border-b border-line bg-warn/[.04] px-5 py-3">
          <span className="text-[12.5px] font-semibold text-warn">{t("tk.waiting.title")}</span>
          {open.map((r) => (
            <RequestCard key={r.id} r={r} canReply compact onFulfill={fulfill} />
          ))}
        </div>
      )}
      <div className="scroll min-h-0 flex-1 px-5 py-4">
        <Timeline d={d} onFulfill={fulfill} />
        <div ref={bottom} />
      </div>
      <div className="px-5 pb-4 pt-1">
        <Composer d={d} fulfills={fulfills} setFulfills={setFulfills} onAttach={() => setPreset({ fulfills: [] })} inputRef={input} />
      </div>
      <AttachDialog d={d} preset={preset} onClose={() => setPreset(null)} />
    </div>
  );
}
