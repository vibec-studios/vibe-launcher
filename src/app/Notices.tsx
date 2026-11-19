// Hinweis-Leiste oben über dem Inhalt: eingebauter, einmaliger Hinweis zum Domain-Umzug und Ankündigungen des
// Backends (`GET /api/v1/announcements`, docs/DOMAINS.md). Abruf beim Start und alle 30 min, nur mit eingeschaltetem
// Vibe-Hauptschalter; Fehler bleiben still. Jede `id` lässt sich wegklicken und bleibt dann ausgeblendet
// (`settings.dismissed_notices`). Der eingebaute Hinweis hat dieselbe ID wie die Ankündigung `domain-move-2026-11` –
// er erscheint also nie doppelt.
import { useEffect, useState } from "react";
import { create } from "zustand";
import { AlertTriangle, ArrowUpRight, Info, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Announcement } from "@/lib/types";
import { useSettings } from "@/lib/queries";
import { useVibe } from "@/lib/vibe";
import { patchSettings } from "@/lib/mode";
import { DOMAIN_MOVE_NOTICE } from "@/lib/domains";
import { openExternal } from "@/components/content/util";
import { useOnboarding } from "@/features/onboarding/store";
import { cn } from "@/components/ui";
import { useLang, useT } from "@/i18n";

const POLL_MS = 30 * 60_000;

const useAnnouncements = create<{ items: Announcement[] }>(() => ({ items: [] }));

/** Abruf beim Start, alle 30 min und beim Sprachwechsel. Hauptschalter aus -> keine Anfrage, nichts anzeigen. */
function useAnnouncementPoll() {
  const on = useVibe().enabled;
  const ready = useSettings().isSuccess;
  const lang = useLang((s) => s.lang);
  useEffect(() => {
    if (!ready) return;
    if (!on) {
      useAnnouncements.setState({ items: [] });
      return;
    }
    let dead = false;
    const load = () =>
      api
        .vibeAnnouncements(lang)
        .then((items) => !dead && useAnnouncements.setState({ items }))
        .catch(() => {
          /* still: ohne Abruf keine Ankündigungen (alte Liste bleibt bis zum nächsten Erfolg) */
        });
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [on, ready, lang]);
}

/** Sichtbare Hinweise: eingebauter Umzugs-Hinweis zuerst, dann Ankündigungen (ohne Doppelte, ohne weggeklickte). */
export function mergeNotices(builtin: Announcement[], remote: Announcement[], dismissed: readonly string[]): Announcement[] {
  const out: Announcement[] = [];
  for (const n of [...builtin, ...remote]) {
    if (dismissed.includes(n.id) || out.some((x) => x.id === n.id)) continue;
    out.push(n);
  }
  return out;
}

export function NoticeBar() {
  const t = useT();
  useAnnouncementPoll();
  const settings = useSettings().data;
  const remote = useAnnouncements((s) => s.items);
  const onboarding = useOnboarding((s) => s.open);
  // Sofort ausblenden, noch bevor die Einstellungen gespeichert sind
  const [hidden, setHidden] = useState<string[]>([]);
  if (!settings || onboarding) return null;

  const builtin: Announcement[] = [
    { id: DOMAIN_MOVE_NOTICE, level: "info", title: t("notice.move.title"), body: t("notice.move.body"), url: null },
  ];
  const list = mergeNotices(builtin, remote, [...(settings.dismissed_notices ?? []), ...hidden]).slice(0, 3);
  if (!list.length) return null;

  const dismiss = (id: string) => {
    setHidden((h) => [...h, id]);
    const prev = settings.dismissed_notices ?? [];
    if (!prev.includes(id)) patchSettings({ dismissed_notices: [...prev, id] }).catch(() => {});
  };

  return (
    <div className="flex shrink-0 flex-col" role="region" aria-label={t("notice.region")}>
      {list.map((n) => (
        <NoticeRow key={n.id} n={n} onDismiss={() => dismiss(n.id)} />
      ))}
    </div>
  );
}

function NoticeRow({ n, onDismiss }: { n: Announcement; onDismiss: () => void }) {
  const t = useT();
  const warn = n.level === "warn";
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 border-b px-6 py-2.5",
        warn ? "border-warn/25 bg-warn/[.07]" : "border-line bg-brand/[.06]",
      )}
    >
      <span className={cn("mt-px grid h-7 w-7 shrink-0 place-items-center rounded-ctl", warn ? "bg-warn/15 text-warn" : "bg-brand/15 text-brand")}>
        {warn ? <AlertTriangle size={15} /> : <Info size={15} />}
      </span>
      <div className="min-w-0 flex-1 py-0.5">
        {n.title && <div className="text-[13px] font-semibold leading-snug text-text">{n.title}</div>}
        {n.body && <p className="selectable mt-0.5 text-[12.5px] leading-snug text-muted">{n.body}</p>}
      </div>
      {n.url && (
        <button
          onClick={() => void openExternal(n.url!)}
          className="mt-0.5 flex h-7 shrink-0 items-center gap-1 rounded-ctl px-2.5 text-[12.5px] font-medium text-brand transition-colors duration-100 hover:bg-white/[.06]"
        >
          {t("notice.more")}
          <ArrowUpRight size={13} />
        </button>
      )}
      <button
        aria-label={t("notice.dismiss")}
        title={t("notice.dismiss")}
        onClick={onDismiss}
        className="-mr-2 mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-ctl text-dim transition-colors duration-100 hover:bg-white/[.07] hover:text-text"
      >
        <X size={15} />
      </button>
    </div>
  );
}
