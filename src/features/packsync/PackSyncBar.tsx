import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff, Check, GitCompareArrows, Share2 } from "lucide-react";
import type { Instance } from "@/lib/types";
import { useVibe } from "@/lib/vibe";
import { Button, Spinner, Switch, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { errText, requireClient, useSocial, vibeClient, vqk } from "@/features/social/service";
import { followPack, isOwnPackError, unfollowPack, useFollowState, vibePackOf } from "./api";
import { openPackDiff } from "./store";

export function PackSyncBar({ instance, className }: { instance: Instance; className?: string }) {
  const t = useT();
  const vibe = useVibe();
  const me = useSocial((s) => s.me);
  const ref = vibePackOf(instance);
  const { follow, loading } = useFollowState(ref?.code ?? null);
  const packQ = useQuery({
    queryKey: vqk.pack(ref?.code ?? ""),
    queryFn: () => requireClient().packs.get(ref!.code),
    enabled: !!ref && vibe.sharing && !!vibeClient() && !follow,
    staleTime: 60_000,
    retry: 0,
  });
  const [busy, setBusy] = useState(false);
  if (!ref || !vibe.sharing || !vibeClient()) return null;

  const pack = follow?.pack ?? packQ.data ?? null;
  const own = !!pack && !!me && pack.owner.id === me.id;
  const latest = pack?.latestVersion ?? null;
  const update = !!latest && latest.id !== ref.versionId;

  const toggle = async () => {
    setBusy(true);
    try {
      if (follow) {
        await unfollowPack(ref.code);
        toast.info(t("psync.unfollowed", { name: pack?.name ?? ref.name ?? ref.code }));
      } else {
        await followPack(ref.code, { notify: true, installedVersionId: ref.versionId });
        toast.success(t("psync.followed", { name: pack?.name ?? ref.name ?? ref.code }), t("psync.followed_text"));
      }
    } catch (e) {
      toast.error(isOwnPackError(e) ? t("psync.own") : errText(e));
    } finally {
      setBusy(false);
    }
  };

  const setNotify = async (on: boolean) => {
    try {
      await followPack(ref.code, { notify: on, installedVersionId: ref.versionId });
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface px-6 py-2.5", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-ctl", update ? "bg-brand/15 text-brand" : "bg-surface2 text-dim")}>
          <Share2 size={15} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-text">
            {own ? t("psync.bar.own", { name: pack?.name ?? ref.name ?? ref.code }) : t("psync.bar.title", { name: pack?.name ?? ref.name ?? ref.code })}
            {ref.versionName && <span className="ml-1.5 font-normal text-dim">{t("psync.bar.version", { v: ref.versionName })}</span>}
          </div>
          <div className="truncate text-caption text-muted">
            {loading ? (
              <Spinner size={10} />
            ) : update ? (
              <span className="font-semibold text-brand">{t("psync.bar.update", { v: latest!.version })}</span>
            ) : own ? (
              t("psync.bar.own_hint")
            ) : follow ? (
              t("psync.bar.following")
            ) : (
              t("psync.bar.not_following")
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {follow && (
          <Tooltip content={t("psync.notify_hint")}>
            <span className="flex items-center gap-2 text-caption text-muted">
              {follow.notify ? <Bell size={13} className="text-dim" /> : <BellOff size={13} className="text-dim" />}
              <Switch checked={follow.notify} onChange={(v) => void setNotify(v)} label={t("psync.notify")} />
            </span>
          </Tooltip>
        )}
        {!own && (
          <Button size="sm" variant={follow ? "subtle" : "ghost"} icon={follow ? <Check size={13} /> : undefined} loading={busy} onClick={() => void toggle()}>
            {follow ? t("psync.following") : t("psync.follow")}
          </Button>
        )}
        {update && (
          <Button size="sm" variant="primary" icon={<GitCompareArrows size={13} />} onClick={() => openPackDiff({ instanceId: instance.id, code: ref.code, toVersionId: latest!.id })}>
            {ref.versionId ? t("psync.show_changes") : t("psync.update_now")}
          </Button>
        )}
      </div>
    </div>
  );
}
