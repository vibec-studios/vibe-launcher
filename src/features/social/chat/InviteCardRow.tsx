import { useQuery } from "@tanstack/react-query";
import { Clock, Globe2, Package, PackageOpen, Play, Server } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { Message, PublicUser } from "@/lib/vibe-sdk";
import { Avatar } from "../FriendsList";
import { loaderName } from "../presence";
import { requireClient, vibeClient, vqk } from "../service";
import { PackIcon } from "../dialogs";
import { openInviteAccept, openPackImport } from "../dialogStore";
import { timeOf } from "./utils";

/** Einladung im Chat als Karte: Art, Ziel, Version, Nachricht, Ablauf, Beitreten. Modpacks zeigen das geteilte
 *  Pack (Icon, Version, Dateien) und „Importieren“. */
export function InviteCardRow({ m, mine, author }: { m: Message; mine: boolean; author: PublicUser | undefined }) {
  const t = useT();
  const inv = m.invite;
  const expired = inv ? Date.parse(inv.expiresAt) < Date.now() : true;
  const isPack = inv?.kind === "modpack";
  const pack = useQuery({
    queryKey: vqk.pack(inv?.packCode ?? ""),
    queryFn: () => requireClient().packs.get(inv!.packCode!),
    enabled: !!inv?.packCode && !!vibeClient(),
    retry: 0,
    staleTime: 60_000,
  });
  const Icon = isPack ? Package : inv?.kind === "server" ? Server : Globe2;
  const p = pack.data;
  return (
    <div className={cn("flex gap-3 px-5 pt-3", mine && "flex-row-reverse")}>
      {!mine && <div className="w-8 shrink-0">{author && <Avatar user={author} size={32} />}</div>}
      <div className={cn("flex min-w-0 max-w-[400px] flex-1 flex-col", mine && "items-end")}>
        <div className={cn("mb-1 flex items-baseline gap-2 px-0.5", mine && "flex-row-reverse")}>
          {!mine && <span className="text-[13px] font-semibold text-text">{author?.name ?? t("social.msg.unknown")}</span>}
          <span className="text-[11px] tabular-nums text-dim">{timeOf(m.createdAt)}</span>
        </div>
        <div className="w-full overflow-hidden rounded-card bg-surface2">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-[11.5px] font-semibold text-muted">
            <Icon size={13} className="text-brand" />
            {t(`social.invite.kind.${inv?.kind ?? "server"}`)}
          </div>
          <div className="flex items-center gap-3 px-3.5 py-3">
            {isPack && p ? (
              <PackIcon pack={p} size={44} />
            ) : (
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-card bg-white/[.05] text-muted">
                <Icon size={20} strokeWidth={1.8} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-bold leading-tight text-text">{p?.name ?? inv?.title ?? "—"}</div>
              <div className="mt-0.5 truncate text-[12px] text-muted">
                {isPack && p ? [p.mcVersion, loaderName(p.loader), p.latestVersion ? t("social.pack.files", { n: p.latestVersion.fileCount }) : null].filter(Boolean).join(" · ") : inv?.subtitle}
              </div>
            </div>
          </div>
          {m.content && <p className="selectable whitespace-pre-wrap break-words px-3.5 pb-3 text-[13px] leading-snug text-text">{m.content}</p>}
          <div className="flex items-center gap-2 bg-white/[.02] px-3.5 py-2.5">
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] text-dim">
              <Clock size={12} />
              {expired ? t("social.invite.expired") : isPack ? t("social.invite.pack_code", { code: inv?.packCode ?? "" }) : t("social.invite.until", { time: timeOf(inv!.expiresAt) })}
            </span>
            {!mine && inv && !expired && (
              <Button
                size="sm"
                variant="primary"
                icon={isPack ? <PackageOpen size={13} /> : <Play size={13} />}
                onClick={() => (isPack && inv.packCode ? openPackImport(inv.packCode) : openInviteAccept({ inviteId: inv.inviteId }))}
              >
                {isPack ? t("social.invite.import") : t("social.accept.join")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
