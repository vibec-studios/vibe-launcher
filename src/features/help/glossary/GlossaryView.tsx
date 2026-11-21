import { useEffect, useRef } from "react";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import { useHelp } from "../store";
import { TERMS, matchTerm, useGlossary } from "./index";

export function GlossaryView({ query = "" }: { query?: string }) {
  const t = useT();
  const glossary = useGlossary();
  const focus = useHelp((s) => s.term);
  const list = TERMS.filter((id) => matchTerm(glossary[id], query));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    ref.current?.querySelector(`[data-glossary="${focus}"]`)?.scrollIntoView({ block: "center" });
  }, [focus]);
  return (
    <article ref={ref} className="flex flex-col gap-4" data-testid="glossary">
      <header>
        <h3 className="text-section text-text">{t("usab.glossary.title")}</h3>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{t("usab.glossary.desc")}</p>
      </header>
      <dl className="flex flex-col gap-2">
        {list.map((id) => {
          const term = glossary[id];
          return (
            <div
              key={id}
              data-glossary={id}
              className={cn("rounded-card bg-surface px-4 py-3", focus === id && "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ui-accent)_55%,transparent)]")}
            >
              <dt className="text-[13.5px] font-semibold text-text">{term.title}</dt>
              <dd className="mt-0.5 text-[13px] leading-relaxed text-muted">{term.text}</dd>
              {term.example && <dd className="mt-1.5 text-[12.5px] leading-snug text-dim">{term.example}</dd>}
            </div>
          );
        })}
        {!list.length && <p className="text-[12.5px] text-dim">{t("help.no_match")}</p>}
      </dl>
    </article>
  );
}
