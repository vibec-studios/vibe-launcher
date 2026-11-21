import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { BookOpen } from "lucide-react";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import { openHelp } from "../store";
import { useGlossary, type TermId } from "./index";

export function Term({ id, children, className }: { id: TermId; children?: ReactNode; className?: string }) {
  const t = useT();
  const term = useGlossary()[id];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-term={id}
          onClick={(e) => e.stopPropagation()}
          aria-label={t("usab.term.explain", { term: term.title })}
          className={cn(
            "inline cursor-help underline decoration-dotted decoration-1 underline-offset-[3px] [text-decoration-color:color-mix(in_srgb,currentColor_55%,transparent)] hover:text-text",
            className,
          )}
        >
          {children ?? term.title}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onClick={(e) => e.stopPropagation()}
          className="z-[90] w-[300px] rounded-card bg-overlay p-3.5 text-left shadow-e2 outline-none data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          <div className="text-[13.5px] font-semibold text-text">{term.title}</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{term.text}</p>
          {term.example && <p className="mt-2 rounded-ctl bg-white/[.04] px-2.5 py-2 text-[12px] leading-snug text-muted">{term.example}</p>}
          <Popover.Close asChild>
            <button
              type="button"
              onClick={() => openHelp("glossary", id)}
              className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-accent hover:underline"
            >
              <BookOpen size={13} />
              {t("usab.term.all")}
            </button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
