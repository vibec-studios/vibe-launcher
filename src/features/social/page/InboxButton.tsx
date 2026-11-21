import * as Popover from "@radix-ui/react-popover";
import { Inbox } from "lucide-react";
import { IconButton } from "@/components/ui";
import { useT } from "@/i18n";
import { PixelIcon } from "@/components/ui/pixel/PixelIcon";
import { GroupLabel, RequestRow } from "../FriendsList";
import { useSocial } from "../service";
import { InviteRow } from "./InviteRow";

// ------------------------------------------------------------------ Postfach

export function InboxButton() {
  const t = useT();
  const requests = useSocial((s) => s.requests);
  const invites = useSocial((s) => s.invites);
  const incoming = requests.filter((r) => r.direction === "incoming");
  const outgoing = requests.filter((r) => r.direction === "outgoing");
  const badge = incoming.length + invites.length;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <IconButton label={t("social.inbox.title")} tip variant="ghost" size="sm" badge={badge} className="data-[state=open]:bg-white/[.07] data-[state=open]:text-text">
          <Inbox size={15} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[60] flex max-h-[min(560px,calc(100vh-120px))] w-[360px] flex-col rounded-card bg-overlay shadow-e2 outline-none data-[state=open]:animate-pop-in"
        >
          <div className="flex h-10 shrink-0 items-center border-b border-line px-3.5">
            <span className="flex-1 text-section text-text">{t("social.inbox.title")}</span>
          </div>
          <div className="scroll min-h-0 flex-1 pb-1.5">
            {!invites.length && !requests.length ? (
              <div className="px-6 py-10 text-center">
                <PixelIcon name="inbox" size={32} className="mx-auto mb-2 text-muted" />
                <p className="text-[13px] font-semibold text-text">{t("social.inbox.empty")}</p>
                <p className="mt-1 text-[12px] text-muted">{t("social.inbox.empty_text")}</p>
              </div>
            ) : (
              <>
                {invites.length > 0 && (
                  <>
                    <GroupLabel>{t("social.invites.title", { n: invites.length })}</GroupLabel>
                    {invites.map((inv) => (
                      <InviteRow key={inv.id} inv={inv} />
                    ))}
                  </>
                )}
                {incoming.length > 0 && (
                  <>
                    <GroupLabel>{t("social.req.title_in", { n: incoming.length })}</GroupLabel>
                    {incoming.map((r) => (
                      <RequestRow key={r.id} r={r} />
                    ))}
                  </>
                )}
                {outgoing.length > 0 && (
                  <>
                    <GroupLabel>{t("social.req.title_out", { n: outgoing.length })}</GroupLabel>
                    {outgoing.map((r) => (
                      <RequestRow key={r.id} r={r} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
