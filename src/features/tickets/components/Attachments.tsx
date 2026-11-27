import { useState } from "react";
import { FileText, Image as ImageIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { TicketAttachment, TicketAttachmentData } from "@/lib/types";
import { formatBytes } from "@/lib/format";
import { Dialog, Spinner, cn, toast } from "@/components/ui";
import { Lightbox } from "@/components/ui/Lightbox";
import { useT } from "@/i18n";
import { ticketCall, ticketErrorText } from "../call";

function Chip({ a, ticket }: { a: TicketAttachment; ticket: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<TicketAttachmentData | null>(null);
  const open = async () => {
    setBusy(true);
    try {
      setData(await ticketCall(() => api.ticketAttachment(ticket, a.id)));
    } catch (e) {
      toast.error(ticketErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const Icon = a.kind === "screenshot" ? ImageIcon : FileText;
  const usable = a.available && !!a.url;
  return (
    <>
      <button
        disabled={!usable || busy}
        onClick={open}
        title={usable ? a.filename : t("tk.att.gone")}
        className={cn(
          "inline-flex h-7 max-w-full items-center gap-1.5 rounded-xs bg-white/[.06] px-2 text-[11.5px] text-muted transition-colors",
          usable ? "hover:bg-white/[.1] hover:text-text" : "opacity-60",
        )}
      >
        {busy ? <Spinner size={12} /> : <Icon size={12} className="shrink-0" />}
        <span className="truncate font-mono">{a.filename}</span>
        <span className="shrink-0 text-dim">{usable ? formatBytes(a.size) : t("tk.att.gone_short")}</span>
      </button>
      {data?.data_url && (
        <Lightbox
          images={[{ url: data.data_url, title: a.filename }]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setData(null)}
          labels={{ prev: t("common.back"), next: t("fb.next"), close: t("common.close") }}
        />
      )}
      {data && data.text !== null && (
        <Dialog open onOpenChange={(o) => !o && setData(null)} title={a.filename} size="lg">
          <pre className="selectable scroll max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-card bg-black/25 px-3.5 py-2.5 font-mono text-[11.5px] leading-[1.55] text-muted">
            {data.text}
          </pre>
        </Dialog>
      )}
    </>
  );
}

export function Attachments({ items, ticket, className }: { items: TicketAttachment[]; ticket: string; className?: string }) {
  if (!items.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((a) => (
        <Chip key={a.id} a={a} ticket={ticket} />
      ))}
    </div>
  );
}
