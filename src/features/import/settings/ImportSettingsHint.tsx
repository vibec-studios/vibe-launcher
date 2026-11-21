import { useQuery } from "@tanstack/react-query";
import { History, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useOnboarding } from "@/features/onboarding/store";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { useSettings } from "@/lib/queries";
import { IMPORT_DATA_NOTICE, IMPORT_SETTINGS_NOTICE, applyAll, dataDefaultsOf, dataLabel, defaultsOf, dismissNotice, openSettingsReview, pendingKey, useReview } from "./state";

// ------------------------------------------------------------------ Hinweis unten links

export function ImportSettingsHint() {
  const t = useT();
  const s = useSettings().data;
  const onboarding = useOnboarding((x) => x.open);
  const hidden = useReview((x) => x.hintHidden || x.open);
  const [busy, setBusy] = useState(false);
  // Nicht gleichzeitig mit dem Hinweis „Neu: Einfacher Modus“ (gleiche Stelle)
  const simpleHint = !!s && s.onboarding_done && !s.simple_hint_seen && s.ui_mode === "expert";
  const dismissed = s?.dismissed_notices ?? [];
  const withSettings = !dismissed.includes(IMPORT_SETTINGS_NOTICE);
  const withData = !dismissed.includes(IMPORT_DATA_NOTICE);
  const eligible = !!s && s.onboarding_done && !onboarding && !simpleHint && (withSettings || withData);
  const pending = useQuery({ queryKey: pendingKey, queryFn: api.importSettingsPending, enabled: eligible, staleTime: Infinity, retry: 0 });
  // Je Instanz nur, was der Hinweis anbieten darf (Einstellungen bzw. Daten je nach ausgeblendeter ID)
  const offers = (pending.data ?? [])
    .map((o) => ({ ...o, changes: withSettings ? o.changes.filter((c) => c.default_on) : [], data: withData ? o.data.filter((d) => d.default_on) : [] }))
    .filter((o) => o.changes.length || o.data.length);
  if (!eligible || hidden || !offers.length) return null;

  const what = [...new Set(offers.flatMap((o) => o.changes.map((c) => c.key)))]
    .slice(0, 3)
    .map((k) => t(`ext.set.key.${k}`))
    .join(", ");
  const data = [...new Set(offers.flatMap((o) => o.data.map(dataLabel)))].slice(0, 3).join(", ");
  const kind = what && data ? "both" : data ? "data" : "settings";
  const found =
    offers.length === 1
      ? t(kind === "settings" ? "isx.hint.found_1" : `isx.hint.found_${kind}_1`, { name: offers[0].instance_name, what, data })
      : t(kind === "settings" ? "isx.hint.found_n" : `isx.hint.found_${kind}_n`, { n: offers.length, what, data });
  const later = () => useReview.setState({ hintHidden: true });
  const never = () => {
    later();
    dismissNotice();
  };
  const applyNow = async () => {
    setBusy(true);
    const keys = Object.fromEntries(offers.map((o) => [o.instance_id, defaultsOf(o)]));
    const picks = Object.fromEntries(offers.map((o) => [o.instance_id, dataDefaultsOf(o)]));
    const ok = await applyAll(offers, keys, picks);
    setBusy(false);
    if (ok) never();
  };

  return (
    <div
      role="status"
      className="vl-bubble fixed bottom-4 z-[45] flex w-[380px] flex-col gap-3 rounded-card bg-overlay p-4 shadow-e3"
      style={{ left: "calc(var(--rail-w) + 16px)" }}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-card bg-brand/15 text-brand">
          <History size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-text">{t("isx.hint.title")}</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{t("isx.hint.text")}</p>
          <p className="mt-1 text-[12px] leading-snug text-dim">{found}</p>
        </div>
        <button aria-label={t("isx.hint.later")} title={t("isx.hint.later")} onClick={later} className="-mr-1.5 -mt-1 grid h-7 w-7 place-items-center rounded-ctl text-dim hover:bg-white/[.07] hover:text-text">
          <X size={15} />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="subtle" className="px-2" onClick={later} disabled={busy}>
          {t("isx.hint.later")}
        </Button>
        <Button size="sm" variant="subtle" className="px-2" onClick={never} disabled={busy}>
          {t("isx.hint.never")}
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={() => openSettingsReview(null)} disabled={busy}>
          {t("isx.hint.view")}
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void applyNow()}>
          {t("isx.hint.apply")}
        </Button>
      </div>
    </div>
  );
}
