import { useState, type ReactNode } from "react";
import { Check, Copy, LifeBuoy } from "lucide-react";
import { Button, IconButton, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import { copyText } from "@/features/files/util";
import { openTicket } from "@/features/tickets/store";
import { closeFeedback } from "../store";

// ------------------------------------------------------------------ Danke

export function DoneStep({ ticket }: { ticket: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3 px-4 pb-4 pt-2 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-pill bg-ok/15 text-ok">
        <Check size={28} strokeWidth={2.5} />
      </div>
      <p className="text-[15px] font-semibold text-text">
        {renderTicketSentence(t("fb.done.text", { ticket: "\u0000" }), ticket)}
      </p>
      <div className="flex items-center gap-2 rounded-ctl bg-field py-1 pl-3 pr-1">
        <span className="selectable font-mono text-[15px] font-semibold tracking-wide text-text" data-testid="fb-ticket">
          {ticket}
        </span>
        <Tooltip content={copied ? t("fb.done.copied") : t("fb.done.copy")} side="top">
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
      </div>
      <p className="max-w-[420px] text-[12.5px] text-muted">{t("fb.done.hint")}</p>
      <Button
        size="sm"
        variant="subtle"
        icon={<LifeBuoy size={13} />}
        data-testid="fb-view-ticket"
        onClick={() => {
          closeFeedback();
          openTicket(ticket);
        }}
      >
        {t("tk.view")}
      </Button>
    </div>
  );
}

function renderTicketSentence(s: string, ticket: string): ReactNode {
  const [a, b] = s.split("\u0000");
  return (
    <>
      {a}
      <span className="font-mono text-brand">{ticket}</span>
      {b}
    </>
  );
}
