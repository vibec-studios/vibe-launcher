// Einstellungen → „Vibe & Konto“: Verbindungsstatus, verknüpfter Minecraft-Account, „Verbinden“ /
// „Verknüpfung lösen“, Privatsphäre (nur wenn verbunden) und „Vibe-Konto löschen“.
import { useNavigate } from "@tanstack/react-router";
import { Link2, Link2Off, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Field, Input, Select, SettingRow, SettingsCard, Spinner, cn, toast } from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { useT } from "@/i18n";
import { useAccounts } from "@/lib/queries";
import type { Me, Privacy, PrivacyLevel, PresenceStatusSetting } from "@/lib/vibe-sdk";
import { closeSettings } from "@/features/settings/store";
import { connect, deleteAccount, errText, requireClient, unlink, useSocial, type Conn } from "./service";

/** Gespeicherte Vibe-Anmeldung vorhanden (auch wenn das Gateway gerade getrennt ist). */
function useLinked() {
  return useSocial((s) => s.linked && s.conn !== "logged_out" && s.conn !== "logging_in");
}

function StatusPill({ conn, unlinked }: { conn: Conn; unlinked: boolean }) {
  const t = useT();
  const tone =
    conn === "ready" ? "ok" : conn === "connecting" || conn === "logging_in" || conn === "reconnecting" ? "warn" : conn === "offline" ? "danger" : "dim";
  const label = conn === "logged_out" && unlinked ? t("vibe.account.state.unlinked") : t(`vibe.account.state.${conn}`);
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-pill px-2 text-caption font-semibold",
        tone === "ok" && "bg-ok/10 text-ok",
        tone === "warn" && "bg-warn/10 text-warn",
        tone === "danger" && "bg-danger/10 text-danger",
        tone === "dim" && "bg-surface2 text-muted",
      )}
    >
      {tone === "warn" ? <Spinner size={9} /> : <span className={cn("h-1.5 w-1.5 rounded-dot", tone === "ok" ? "bg-ok" : tone === "danger" ? "bg-danger" : "bg-dim")} />}
      {label}
    </span>
  );
}

export function VibeAccountCard() {
  const t = useT();
  const nav = useNavigate();
  const conn = useSocial((s) => s.conn);
  const me = useSocial((s) => s.me);
  const identity = useSocial((s) => s.identity);
  const unlinked = useSocial((s) => s.unlinked);
  const error = useSocial((s) => s.error);
  const linked = useLinked();
  const { data: accounts = [] } = useAccounts();
  const account = accounts.find((a) => a.active) ?? accounts[0];
  const [busy, setBusy] = useState(false);
  const name = me?.name ?? identity ?? account?.username ?? null;

  const subline =
    conn === "no_account"
      ? t("social.conn.no_account_text")
      : conn === "logged_out"
        ? unlinked
          ? t("vibe.account.unlinked_text")
          : t("vibe.account.logged_out_text")
        : conn === "logging_in"
          ? t("social.conn.logging_in")
          : conn === "offline"
            ? t("social.conn.offline_retry")
            : conn === "off"
              ? t("social.settings.gateway_off")
              : t("vibe.account.linked_text");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard title={t("vibe.account.title")} right={<StatusPill conn={conn} unlinked={unlinked} />}>
      <div className="flex items-center gap-4 px-4 py-3.5">
        {name ? (
          <PlayerHead uuid={me?.id ?? account?.uuid ?? ""} name={name} size={40} />
        ) : (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-surface2 text-dim">
            <UserRound size={20} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-tight text-text">{name ?? t("social.conn.no_account_title")}</div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{subline}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {conn === "no_account" ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                closeSettings();
                nav({ to: "/accounts" });
              }}
            >
              {t("nav.accounts")}
            </Button>
          ) : conn === "logged_out" ? (
            <Button size="sm" variant="primary" icon={<Link2 size={14} />} loading={busy} onClick={() => run(connect)}>
              {t("vibe.account.connect")}
            </Button>
          ) : linked ? (
            <Button size="sm" variant="ghost" icon={<Link2Off size={14} />} loading={busy} onClick={() => run(unlink)}>
              {t("vibe.account.unlink")}
            </Button>
          ) : null}
        </div>
      </div>
      {error && conn === "logged_out" && <div className="border-t border-line px-4 py-2.5 text-[12.5px] text-danger">{error}</div>}
      <div className="border-t border-line px-4 py-2.5 text-[12px] leading-relaxed text-dim">{t("vibe.account.auto_hint")}</div>
    </SettingsCard>
  );
}

export function VibePrivacyCard() {
  const t = useT();
  const conn = useSocial((s) => s.conn);
  const me = useSocial((s) => s.me);
  if (conn !== "ready" || !me) return null;
  return (
    <SettingsCard title={t("vibe.privacy.title")}>
      <PrivacyRows me={me} />
    </SettingsCard>
  );
}

export function VibeDangerCard() {
  const t = useT();
  const linked = useLinked();
  const [open, setOpen] = useState(false);
  if (!linked) return null;
  return (
    <SettingsCard title={t("vibe.danger.title")} danger>
      <SettingRow title={t("vibe.delete.title")} description={t("vibe.delete.desc")}>
        <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => setOpen(true)}>
          {t("vibe.delete.button")}
        </Button>
      </SettingRow>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </SettingsCard>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const me = useSocial((s) => s.me);
  const identity = useSocial((s) => s.identity);
  const name = me?.name ?? identity ?? "";
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = !!name && typed.trim().toLowerCase() === name.toLowerCase();
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteAccount();
      toast.success(t("vibe.delete.done"), t("vibe.delete.done_text"));
      onClose();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      locked={busy}
      size="sm"
      title={t("vibe.delete.q")}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" icon={<Trash2 size={14} />} disabled={!ok} loading={busy} onClick={submit}>
            {t("vibe.delete.confirm")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-[13px] leading-relaxed text-muted">{t("vibe.delete.text")}</p>
        <ul className="flex flex-col gap-1 rounded-card bg-danger/10 px-4 py-3 text-[12.5px] text-text">
          {(["friends", "chats", "packs", "devices"] as const).map((k) => (
            <li key={k} className="flex items-center gap-2">
              <span className="h-1 w-1 shrink-0 rounded-dot bg-danger" />

              {t(`vibe.delete.item.${k}`)}
            </li>
          ))}
        </ul>
        <Field label={t("vibe.delete.type", { name })} error={err ?? undefined}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} autoFocus spellCheck={false} autoComplete="off" className="font-mono text-[13px]" />
        </Field>
      </form>
    </Dialog>
  );
}

function PrivacyRows({ me }: { me: Me }) {
  const t = useT();
  const levels = (keys: PrivacyLevel[]) => keys.map((k) => ({ value: k, label: t(`social.privacy.level.${k}`) }));
  const patch = async (p: { privacy?: Partial<Privacy> }) => {
    try {
      const next = await requireClient().me.update(p);
      useSocial.setState({ me: next });
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const setStatus = async (s: PresenceStatusSetting) => {
    useSocial.setState({ me: { ...me, presenceStatus: s } });
    try {
      await requireClient().presence.set({ status: s });
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <>
      <SettingRow title={t("social.settings.status")} description={t("social.settings.status.desc")}>
        <Select<PresenceStatusSetting>
          size="sm"
          className="w-[200px]"
          value={me.presenceStatus}
          onChange={setStatus}
          options={(["online", "away", "busy", "invisible"] as const).map((k) => ({ value: k, label: t(`social.status.${k}`) }))}
        />
      </SettingRow>
      <SettingRow title={t("social.privacy.requests")}>
        <Select<PrivacyLevel>
          size="sm"
          className="w-[200px]"
          value={me.privacy.friendRequests}
          onChange={(v) => patch({ privacy: { friendRequests: v } })}
          options={levels(["everyone", "friends_of_friends", "nobody"])}
        />
      </SettingRow>
      <SettingRow title={t("social.privacy.dms")}>
        <Select<PrivacyLevel>
          size="sm"
          className="w-[200px]"
          value={me.privacy.directMessages}
          onChange={(v) => patch({ privacy: { directMessages: v } })}
          options={levels(["everyone", "friends_of_friends", "friends", "nobody"])}
        />
      </SettingRow>
      <SettingRow title={t("social.privacy.invites")}>
        <Select<PrivacyLevel>
          size="sm"
          className="w-[200px]"
          value={me.privacy.invites}
          onChange={(v) => patch({ privacy: { invites: v } })}
          options={levels(["everyone", "friends_of_friends", "friends", "nobody"])}
        />
      </SettingRow>
      <SettingRow title={t("social.privacy.hosting")} description={t("social.privacy.hosting.desc")}>
        <Select<"1" | "0">
          size="sm"
          className="w-[200px]"
          value={me.privacy.showHosting ? "1" : "0"}
          onChange={(v) => patch({ privacy: { showHosting: v === "1" } })}
          options={[
            { value: "1", label: t("social.privacy.level.friends") },
            { value: "0", label: t("social.privacy.level.nobody") },
          ]}
        />
      </SettingRow>
    </>
  );
}
