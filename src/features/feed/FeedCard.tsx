import { useState } from "react";
import { Camera, Gamepad2, PackagePlus, Sparkles } from "lucide-react";
import { Button, Skeleton, Switch, toast } from "@/components/ui";
import { Lightbox } from "@/components/ui/Lightbox";
import { useT } from "@/i18n";
import { formatRelative } from "@/lib/format";
import type { FeedItem } from "@/lib/vibe-sdk";
import { Avatar } from "@/features/social/FriendsList";
import { errText, useSocial } from "@/features/social/service";
import { useVibeImage } from "@/features/shotshare/api";
import { setFeedEnabled, useFeed, useFeedPrefs } from "./api";

export function FeedSwitch() {
  const t = useT();
  const prefs = useFeedPrefs();
  const [busy, setBusy] = useState(false);
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await setFeedEnabled(on);
      toast.success(t(on ? "feed.enabled" : "feed.disabled"));
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return <Switch checked={!!prefs.data?.enabled} disabled={!prefs.data || busy} onChange={(on) => void toggle(on)} label={t("feed.switch")} />;
}

function FeedShot({ path, name }: { path: string; name: string }) {
  const t = useT();
  const q = useVibeImage(path);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => q.data && setOpen(true)} className="relative mt-2 block aspect-video w-full overflow-hidden rounded-ctl bg-surface2" aria-label={t("feed.open_shot", { name })}>
        {q.data ? <img src={q.data} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" /> : !q.isError && <span className="skeleton absolute inset-0" />}
      </button>
      <Lightbox
        images={q.data ? [{ url: q.data, title: name }] : []}
        index={open ? 0 : null}
        onIndexChange={() => {}}
        onClose={() => setOpen(false)}
        labels={{ prev: t("shots.prev"), next: t("shots.next"), close: t("common.close") }}
      />
    </>
  );
}

function Item({ it }: { it: FeedItem }) {
  const t = useT();
  const friend = useSocial((s) => s.friends[it.userId]);
  const icon = it.type === "screenshot" ? <Camera size={12} /> : it.type === "played" ? <Gamepad2 size={12} /> : <PackagePlus size={12} />;
  return (
    <li className="flex gap-2.5 py-2.5 [&+&]:border-t [&+&]:border-line">
      <div className="shrink-0 pt-0.5">{friend ? <Avatar user={friend.user} size={26} /> : <span className="block h-[26px] w-[26px] rounded-full bg-surface3" />}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-snug text-text">
          <span className="font-semibold">{it.name}</span> {t(`feed.type.${it.type}`)}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-dim">
          {icon}
          {formatRelative(it.createdAt)}
        </p>
        {it.type === "screenshot" && <FeedShot path={it.imagePath} name={it.name} />}
      </div>
    </li>
  );
}

export function FeedCard() {
  const t = useT();
  const prefs = useFeedPrefs();
  const feed = useFeed();
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="rounded-card bg-surface px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-text">{t("feed.title")}</h3>
        <Sparkles size={14} className="text-brand" />
      </div>
      {prefs.data && !prefs.data.enabled && (
        <div className="mt-2.5 flex flex-col gap-2 rounded-ctl bg-white/[.03] px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-muted">{t("feed.optin.text")}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-text">{t("feed.switch")}</span>
            <FeedSwitch />
          </div>
        </div>
      )}
      {!feed.data ? (
        feed.isError ? (
          <p className="mt-2.5 text-[12px] text-dim">{errText(feed.error)}</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-40" />
          </div>
        )
      ) : items.length === 0 ? (
        <p className="mt-2.5 text-[12px] leading-relaxed text-dim">{t("feed.empty")}</p>
      ) : (
        <>
          <ul className="mt-1 flex flex-col">
            {items.map((it) => (
              <Item key={it.id} it={it} />
            ))}
          </ul>
          {feed.hasNextPage && (
            <Button size="sm" variant="subtle" className="mt-1 w-full" loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
              {t("feed.more")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
