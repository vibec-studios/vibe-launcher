// Teilen aus dem Launcher: Läuft eine Instanz und meldet `session.json` „hosting“ mit `play_link`, zeigen Instanzseite
// und Freunde-Bereich „Einladungslink kopieren“ und „An Freund senden“ (docs/PLAY-LINKS.md).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Link2, Send } from "lucide-react";
import { api } from "@/lib/api";
import { useGameStore } from "@/lib/queries";
import type { RunningSession } from "@/lib/types";
import { useVibe } from "@/lib/vibe";
import { Button, Checkbox, Dialog, cn, toast } from "@/components/ui";
import { copyText } from "@/components/content/util";
import { useT, t as tt } from "@/i18n";
import { useFriends } from "@/features/social/hooks";
import { Avatar } from "@/features/social/FriendsList";
import { errText, openDm, sendMessage, useSocial } from "@/features/social/service";
import { ManualModsWarning, needsManualWarning, useManualMods } from "./ManualModsWarning";
import { PlayLinkExtras, useLinkOverride } from "./PlayLinkExtras";

/** `session.json` der laufenden Instanzen (alle 5 s, solange etwas läuft). */
export function usePlaySessions(): RunningSession[] {
  const running = useGameStore((s) => Object.values(s.states).some((g) => g.state === "running"));
  const q = useQuery({ queryKey: ["play-sessions"], queryFn: api.playSessions, enabled: running, refetchInterval: running ? 5000 : false, staleTime: 2000 });
  return running ? (q.data ?? []) : [];
}

/** Aktueller Spiel-Link (einer bestimmten oder irgendeiner hostenden Instanz). */
export function useHostingLink(instanceId?: string): RunningSession | null {
  const list = usePlaySessions();
  return useMemo(
    () => list.find((r) => (!instanceId || r.instance_id === instanceId) && r.session.state === "hosting" && !!r.session.play_link) ?? null,
    [list, instanceId],
  );
}

export function PlayLinkBar({ instanceId, compact, className }: { instanceId?: string; compact?: boolean; className?: string }) {
  const t = useT();
  const vibe = useVibe();
  const conn = useSocial((s) => s.conn);
  const hosting = useHostingLink(instanceId);
  const [copied, setCopied] = useState(false);
  const [send, setSend] = useState(false);
  const [warn, setWarn] = useState<null | (() => void)>(null);
  const manual = useManualMods(hosting?.instance_id);
  const linkUrl = useLinkOverride(hosting?.instance_id, hosting?.session.play_link);
  if (!hosting || !vibe.enabled || !linkUrl) return null;
  const url = linkUrl;
  const s = hosting.session;
  const guarded = (fn: () => void) => () => (needsManualWarning(hosting.instance_id, manual) ? setWarn(() => fn) : fn());
  const copy = async () => {
    await copyText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const canSend = vibe.social && conn === "ready";
  return (
    <>
      <div className={cn("flex bg-surface", compact ? "flex-col gap-2 px-3 py-2.5" : "items-center gap-3 px-4 py-2.5", className)}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link2 size={15} className="shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-text">
              {s.world ? t("play.share.hosting_world", { world: s.world }) : t("play.share.hosting")}
              {s.players != null && (
                <span className="ml-1.5 font-normal tabular-nums text-dim">{s.max_players ? `${s.players}/${s.max_players}` : s.players}</span>
              )}
            </div>
            {!compact && <div className="selectable truncate font-mono text-caption text-dim">{url}</div>}
          </div>
        </div>
        <div className={cn("flex shrink-0 items-center gap-1.5", compact && "[&>*]:flex-1")}>
          <Button size="sm" variant={compact ? "subtle" : "primary"} icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={guarded(() => void copy())}>
            {copied ? t("common.copied") : compact ? t("play.share.copy_short") : t("play.share.copy")}
          </Button>
          {canSend && (
            <Button size="sm" variant="subtle" icon={<Send size={13} />} onClick={guarded(() => setSend(true))}>
              {compact ? t("play.share.send_short") : t("play.share.send")}
            </Button>
          )}
          <PlayLinkExtras hosting={hosting} url={url} compact={compact} />
        </div>
      </div>
      {send && <SendLinkDialog url={url} world={s.world} onClose={() => setSend(false)} />}
      {warn && <ManualModsWarning instanceId={hosting.instance_id} mods={manual} onProceed={warn} onClose={() => setWarn(null)} />}
    </>
  );
}

/** Link als Direktnachricht an Freunde senden. */
function SendLinkDialog({ url, world, onClose }: { url: string; world: string | null; onClose: () => void }) {
  const t = useT();
  const friends = useFriends();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    let ok = 0;
    const text = world ? tt("play.share.message_world", { world, url }) : tt("play.share.message", { url });
    for (const id of picked) {
      try {
        const chat = await openDm(id);
        await sendMessage(chat.id, text);
        ok++;
      } catch (e) {
        toast.error(errText(e));
      }
    }
    setBusy(false);
    if (ok) {
      toast.success(tt("play.share.sent", { n: ok }));
      onClose();
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("play.share.send_title")}
      description={t("play.share.send_desc")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={!picked.size} onClick={() => void submit()}>
            {t("play.share.send_button", { n: picked.size })}
          </Button>
        </>
      }
    >
      <div className="scroll max-h-64 rounded-card bg-surface py-1">
        {friends.length === 0 && <p className="p-3 text-[12px] text-dim">{t("social.friends.empty")}</p>}
        {friends.map((f) => (
          <label key={f.user.id} className="flex h-9 cursor-pointer items-center gap-2.5 px-3 transition-colors duration-100 hover:bg-white/[.04]">
            <Checkbox
              checked={picked.has(f.user.id)}
              onChange={(on) => {
                const n = new Set(picked);
                if (on) n.add(f.user.id);
                else n.delete(f.user.id);
                setPicked(n);
              }}
            />
            <Avatar user={f.user} size={22} presence={f.presence} />
            <span className="text-[13px] text-text">{f.user.name}</span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}
