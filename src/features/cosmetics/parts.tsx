// Kleine Bausteine der Cosmetics-Seiten: Zugangs-Zustände (ganzseitig und als Banner der Gastansicht),
// Vorschaubild, Seltenheit, Bundle-Hook.
import { useNavigate } from "@tanstack/react-router";
import { CloudOff, ImageOff, LogIn, Settings as SettingsIcon, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Skeleton, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { login } from "@/features/social/service";
import { RARITY_COLOR, loadBundle, useThumbnail, type Access } from "./data";
import type { CatalogItem } from "./types";
import type { Bundle } from "./vibey3d";

/** Freundlicher Zustand, solange keine Vibe-Verbindung möglich ist. */
export function AccessState({ access, title }: { access: Access; title?: string }) {
  const t = useT();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const icon = (n: ReactNode) => <div className="mb-1 text-dim">{n}</div>;
  let body: ReactNode;
  if (access === "loading") body = <Spinner size={18} className="text-brand" />;
  else if (access === "off")
    body = (
      <>
        {icon(<CloudOff size={22} />)}
        <h3 className="text-title text-text">{t("cos.gate.off_title")}</h3>
        <p className="max-w-md text-[13px] leading-relaxed text-muted">{t("cos.gate.off_text")}</p>
        <Button size="sm" icon={<SettingsIcon size={14} />} onClick={() => nav({ to: "/settings", search: { tab: "vibe" } })}>
          {t("action.open_settings")}
        </Button>
      </>
    );
  else if (access === "no_account")
    body = (
      <>
        {icon(<UserRound size={22} />)}
        <h3 className="text-title text-text">{t("cos.gate.account_title")}</h3>
        <p className="max-w-md text-[13px] leading-relaxed text-muted">{t("cos.gate.account_text")}</p>
        <Button size="sm" onClick={() => nav({ to: "/accounts" })}>
          {t("nav.accounts")}
        </Button>
      </>
    );
  else
    body = (
      <>
        {icon(<LogIn size={22} />)}
        <h3 className="text-title text-text">{t("cos.gate.login_title")}</h3>
        <p className="max-w-md text-[13px] leading-relaxed text-muted">{t("cos.gate.login_text")}</p>
        {err && <p className="max-w-md text-[12px] text-danger">{err}</p>}
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          icon={<LogIn size={14} />}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            await login().catch((e) => setErr(String((e as { message?: string })?.message ?? e)));
            setBusy(false);
          }}
        >
          {t("social.conn.login")}
        </Button>
      </>
    );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {title && <div className="mb-2 text-caption font-semibold text-dim">{title}</div>}
      {body}
    </div>
  );
}

/**
 * Kompakter Hinweis über der Gast-Garderobe (ohne Vibe-Login): was fehlt, plus die passende Aktion
 * (Vibe einschalten / Account hinzufügen / verbinden).
 */
export function AccessBanner({ access }: { access: Access }) {
  const t = useT();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (access === "loading" || access === "ready") return null;
  const v =
    access === "off"
      ? { icon: <CloudOff size={16} />, title: t("cos.gate.off_title"), text: t("cos.guest.off_text") }
      : access === "no_account"
        ? { icon: <UserRound size={16} />, title: t("cos.gate.account_title"), text: t("cos.guest.account_text") }
        : { icon: <LogIn size={16} />, title: t("cos.gate.login_title"), text: t("cos.guest.login_text") };
  const action =
    access === "off" ? (
      <Button size="sm" icon={<SettingsIcon size={14} />} onClick={() => nav({ to: "/settings", search: { tab: "vibe" } })}>
        {t("cos.guest.off_action")}
      </Button>
    ) : access === "no_account" ? (
      <Button size="sm" icon={<UserRound size={14} />} onClick={() => nav({ to: "/accounts" })}>
        {t("cos.guest.account_action")}
      </Button>
    ) : (
      <Button
        size="sm"
        variant="primary"
        loading={busy}
        icon={<LogIn size={14} />}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          await login().catch((e) => setErr(String((e as { message?: string })?.message ?? e)));
          setBusy(false);
        }}
      >
        {t("cos.guest.login_action")}
      </Button>
    );
  return (
    <div className="mx-6 mb-3 flex shrink-0 items-center gap-3 rounded-card bg-surface px-4 py-2">
      <div className="shrink-0 text-muted">{v.icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-text">{v.title}</div>
        <div className="text-[12px] leading-snug text-muted">
          {err ? <span className="text-danger">{err}</span> : v.text}
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export function RarityLabel({ rarity, className }: { rarity: string; className?: string }) {
  const t = useT();
  return (
    <span className={cn("font-semibold", className)} style={{ color: RARITY_COLOR[rarity] ?? RARITY_COLOR.common }}>
      {t(`cos.rarity.${rarity}`)}
    </span>
  );
}

/** Ist das Element sichtbar (für Vorschaubilder im Raster)? */
function useVisible<T extends Element>() {
  const ref = useRef<T>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || vis) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVis(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [vis]);
  return [ref, vis] as const;
}

export function ItemThumb({ item, className }: { item: Pick<CatalogItem, "thumbnailUrl" | "asset" | "rarity">; className?: string }) {
  const [ref, vis] = useVisible<HTMLDivElement>();
  const q = useThumbnail(item, vis);
  return (
    <div ref={ref} className={cn("relative grid place-items-center overflow-hidden", className)}>
      {q.data ? (
        <img src={q.data} alt="" draggable={false} className="relative h-full w-full object-contain [image-rendering:pixelated]" />
      ) : q.isError ? (
        <ImageOff size={20} className="text-dim" />
      ) : (
        <Skeleton className="h-full w-full" />
      )}
    </div>
  );
}

/**
 * Bundles zu Asset-Hashes laden. Behält die alte Liste, bis die neue vollständig ist (kein Flackern beim
 * Anprobieren). Liefert `null`-freie Liste in gleicher Reihenfolge (fehlerhafte Assets fallen weg).
 */
export function useBundles(hashes: string[]): Bundle[] {
  const key = hashes.join(",");
  const [list, setList] = useState<Bundle[]>([]);
  useEffect(() => {
    let dead = false;
    void Promise.all(hashes.map((h) => loadBundle(h).catch(() => null))).then((r) => {
      if (!dead) setList(r.filter((b): b is Bundle => !!b));
    });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return list;
}

export function useBundle(hash: string | null): Bundle | null {
  const [b, setB] = useState<Bundle | null>(null);
  useEffect(() => {
    let dead = false;
    if (!hash) {
      setB(null);
      return;
    }
    loadBundle(hash).then(
      (x) => !dead && setB(x),
      () => !dead && setB(null),
    );
    return () => {
      dead = true;
    };
  }, [hash]);
  return b;
}
