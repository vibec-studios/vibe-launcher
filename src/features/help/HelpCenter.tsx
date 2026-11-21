import { Compass } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog, SearchInput, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { GUIDES } from "./content/catalog";
import { useHelpContent } from "./content";
import { GuideIcon } from "./icons";
import { closeHelp, openHelp, useHelp } from "./store";
import { GuideView } from "./GuideView";
import { ToursView } from "./ToursView";
import { matchGuide } from "./search";

export function HelpCenter() {
  const t = useT();
  const { open, view } = useHelp();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeHelp()} title={t("help.title")} description={t("help.desc")} size="xl">
      <HelpBody view={view} />
    </Dialog>
  );
}

function HelpBody({ view }: { view: ReturnType<typeof useHelp.getState>["view"] }) {
  const t = useT();
  const content = useHelpContent();
  const [q, setQ] = useState("");
  const list = useMemo(() => GUIDES.filter((g) => matchGuide(content.guides[g.id], q)), [content, q]);
  const item = (active: boolean) =>
    cn(
      "flex h-9 w-full shrink-0 items-center gap-2.5 rounded-ctl px-2.5 text-left text-[13px] font-medium transition-colors duration-100",
      active ? "bg-white/[.08] text-text" : "text-muted hover:bg-white/[.05] hover:text-text",
    );
  return (
    <div className="grid h-[min(560px,calc(100vh-220px))] grid-cols-[236px_minmax(0,1fr)] gap-5 max-[760px]:grid-cols-[180px_minmax(0,1fr)]">
      <nav className="flex min-h-0 flex-col gap-2" aria-label={t("help.guides")}>
        <SearchInput value={q} onChange={setQ} placeholder={t("help.search")} className="shrink-0 [&_input]:h-8" aria-label={t("help.search")} />
        <div className="scroll flex min-h-0 flex-1 flex-col gap-0.5 pr-1" data-testid="help-list">
          <button className={item(view === "tours")} aria-current={view === "tours" ? "page" : undefined} onClick={() => openHelp("tours")}>
            <span className={view === "tours" ? "text-brand" : "text-dim"}>
              <Compass size={16} />
            </span>
            <span className="truncate">{t("help.tours")}</span>
          </button>
          <div className="px-2.5 pb-1 pt-3 text-[11.5px] font-semibold text-dim">{t("help.guides")}</div>
          {list.map((g) => (
            <button key={g.id} data-guide={g.id} className={item(view === g.id)} aria-current={view === g.id ? "page" : undefined} onClick={() => openHelp(g.id)}>
              <span className={view === g.id ? "text-brand" : "text-dim"}>
                <GuideIcon name={g.icon} />
              </span>
              <span className="truncate">{content.guides[g.id].title}</span>
            </button>
          ))}
          {!list.length && <p className="px-2.5 py-2 text-[12.5px] text-dim">{t("help.no_match")}</p>}
        </div>
      </nav>
      <section key={view} className="scroll min-h-0 animate-fade-in pr-1">
        {view === "tours" ? <ToursView /> : <GuideView id={view} />}
      </section>
    </div>
  );
}
