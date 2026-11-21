// Freundliche Zustände, wenn (noch) keine Verbindung besteht: Dienste aus, kein Account, nicht angemeldet,
// Backend nicht erreichbar. Blockiert nie den Rest des Launchers.
import { useNavigate } from "@tanstack/react-router";
import { LogIn, Settings as SettingsIcon, WifiOff } from "lucide-react";
import { useState } from "react";
import { Button, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { openSettings } from "@/features/settings/store";
import { AccessNotice } from "@/features/access/AccessNotice";
import { JoinWaitlistButton } from "@/features/access/JoinDialog";
import { useKnownApproved } from "@/features/access/hooks";
import { connect, useSocial, type Conn } from "./service";
import { PixelIcon, type PixelMotif } from "@/components/ui/pixel/PixelIcon";

/** Zeigt `children`, sobald Daten da sind; sonst einen passenden Zustand. */
export function Gate({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  const conn = useSocial((s) => s.conn);
  const hasData = useSocial((s) => !!s.me);
  if (conn === "ready" || ((conn === "reconnecting" || conn === "offline" || conn === "connecting") && hasData)) {
    return (
      <>
        <ConnBanner conn={conn} />
        {children}
      </>
    );
  }
  return <GateState conn={conn} compact={compact} />;
}

export function ConnBanner({ conn }: { conn: Conn }) {
  const t = useT();
  if (conn !== "reconnecting" && conn !== "offline" && conn !== "connecting") return null;
  return (
    <div className="flex shrink-0 items-center gap-2 bg-warn/10 px-4 py-1.5 text-[12px] text-warn animate-fade-in">
      {conn === "offline" ? <WifiOff size={13} /> : <Spinner size={11} />}
      {conn === "offline" ? t("social.conn.offline_retry") : t("social.conn.reconnecting")}
    </div>
  );
}

export function GateState({ conn, compact }: { conn: Conn; compact?: boolean }) {
  const t = useT();
  const nav = useNavigate();
  const error = useSocial((s) => s.error);
  const identity = useSocial((s) => s.identity);
  const unlinked = useSocial((s) => s.unlinked);
  const [busy, setBusy] = useState(false);
  const knownOk = useKnownApproved();
  const box = cn("flex h-full flex-col items-center justify-center gap-3 px-6 text-center", compact ? "py-8" : "py-16");
  // Ruhig: Symbol ohne Kachel, kleine Überschrift, ein Satz, höchstens eine Aktion
  const icon = (n: PixelMotif) => <PixelIcon name={n} size={compact ? 32 : 48} className="text-muted" />;
  const title = "text-[15px] font-semibold text-text";

  if (conn === "no_access") return <AccessNotice compact={compact} />;
  if (conn === "connecting" || conn === "logging_in" || conn === "reconnecting") {
    return (
      <div className={box}>
        <Spinner size={18} className="text-muted" />
        <p className="text-[13px] text-muted">{conn === "logging_in" ? t("social.conn.logging_in") : t("social.conn.connecting")}</p>
      </div>
    );
  }
  if (conn === "offline") {
    return (
      <div className={box}>
        {icon("offline")}
        <h3 className={title}>{t("social.conn.offline_title")}</h3>
        <p className="max-w-sm text-[13px] text-muted">{t("social.conn.offline_text")}</p>
      </div>
    );
  }
  if (conn === "off") {
    return (
      <div className={box}>
        {icon("cloud_off")}
        <h3 className={title}>{t("social.conn.off_title")}</h3>
        <p className="max-w-sm text-[13px] text-muted">{knownOk ? t("social.conn.off_text") : t("access.join.desc")}</p>
        {knownOk ? (
          <Button size="sm" icon={<SettingsIcon size={14} />} onClick={() => openSettings("vibe")}>
            {t("action.open_settings")}
          </Button>
        ) : (
          <JoinWaitlistButton />
        )}
      </div>
    );
  }
  if (conn === "no_account") {
    return (
      <div className={box}>
        {icon("user")}
        <h3 className={title}>{t("social.conn.no_account_title")}</h3>
        <p className="max-w-sm text-[13px] text-muted">{t("social.conn.no_account_text")}</p>
        <Button size="sm" variant="primary" onClick={() => nav({ to: "/accounts" })}>
          {t("nav.accounts")}
        </Button>
      </div>
    );
  }
  // logged_out
  return (
    <div className={box}>
      {icon(unlinked ? "user" : "key")}
      <h3 className={title}>

        {unlinked ? t("social.conn.unlinked_title") : error ? t("social.conn.failed_title") : t("social.conn.login_title")}
      </h3>
      <p className="max-w-sm text-[13px] text-muted">
        {unlinked ? t("social.conn.unlinked_text", { name: identity ?? "" }) : t("social.conn.login_text", { name: identity ?? "" })}
      </p>
      {error && <p className="max-w-sm text-[12px] text-danger">{error}</p>}
      <Button
        variant="primary"
        size="sm"
        loading={busy}
        icon={<LogIn size={14} />}
        onClick={async () => {
          setBusy(true);
          await connect().catch(() => {});
          setBusy(false);
        }}
      >
        {unlinked ? t("vibe.account.connect") : error ? t("social.conn.retry") : t("social.conn.login")}
      </Button>
      {!compact && <p className="max-w-sm text-[11px] text-dim">{t("social.conn.login_hint")}</p>}
    </div>
  );
}
