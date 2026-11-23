import { useEffect, useMemo, useState } from "react";
import { intlLocale, useLang, useT } from "@/i18n";
import { useAccounts, useInstances, useSystemInfo } from "@/lib/queries";
import { useSocial } from "@/features/social/service";
import { friendsOnline, greetingPeriod, lastPlayedName } from "@/lib/themes/placeholders";

const CLOCK = new Set(["time", "date", "greeting"]);

export function usePlaceholderValues(keys: readonly string[]): Record<string, string> {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const clock = keys.some((k) => CLOCK.has(k));
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!clock) return;
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, [clock]);
  const accounts = useAccounts().data;
  const instances = useInstances().data;
  const friends = useSocial((s) => s.friends);
  const version = useSystemInfo().data?.version;
  const minute = Math.floor(now.getTime() / 60_000);
  return useMemo(() => {
    const locale = intlLocale(lang);
    const active = accounts?.find((a) => a.active) ?? accounts?.[0];
    const at = new Date(minute * 60_000);
    return {
      greeting: t(`vt.greeting.${greetingPeriod(at)}`),
      player: active?.username ?? t("vt.player_fallback"),
      time: at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      date: at.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }),
      friends_online: String(friendsOnline(Object.values(friends))),
      instances: String(instances?.length ?? 0),
      last_played: (instances && lastPlayedName(instances)) ?? "—",
      version: version ?? "",
    };
  }, [t, lang, accounts, instances, friends, version, minute]);
}
