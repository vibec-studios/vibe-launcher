// Aktionen oben auf der Freunde-Seite: Postfach (Anfragen + Einladungen als Popover) und Popups für
// „Freund hinzufügen“, „Modpack teilen“, „Modpack per Code/Link importieren“ und „Blockierte Nutzer“.
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { copyText as writeText } from "@/components/content/util";
import {
  ArrowRight,
  ChevronRight,
  Copy,
  Ellipsis,
  Inbox,
  Mail,
  PackageOpen,
  Settings as SettingsIcon,
  Share2,
  ShieldOff,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import { create } from "zustand";
import { Button, Dialog, DropdownItem, DropdownMenu, Field, IconButton, Input, SearchInput, Skeleton, Tooltip, cn, confirm, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { useT } from "@/i18n";
import { instanceAccent } from "@/lib/format";
import { useInstances } from "@/lib/queries";
import { useVibe } from "@/lib/vibe";
import type { Invite } from "@/lib/vibe-sdk";
import { openSettings } from "@/features/settings/store";
import { AddFriendSearch, Avatar, BlockedList, GroupLabel, RequestRow } from "./FriendsList";
import { PackIcon, openInviteAccept, openPackImport, openShare } from "./dialogs";
import { errText, removeInviteLocal, requireClient, useSocial, vqk } from "./service";

type PageDialog = "add" | "share" | "import" | "blocked" | null;
const usePageDialog = create<{ open: PageDialog }>(() => ({ open: null }));
export const openPageDialog = (open: PageDialog) => usePageDialog.setState({ open });
const close = () => usePageDialog.setState({ open: null });

/** Buttons oben rechts auf der Freunde-Seite. `iconsOnly` auf schmalen Fenstern. */
export function SocialActions() {
  const t = useT();
  const vibe = useVibe();
  return (
    <div className="flex items-center gap-2">
      <InboxButton />
      <span className="mx-1 h-6 w-px bg-line" />
      <Button size="sm" variant="primary" icon={<UserPlus size={14} />} onClick={() => openPageDialog("add")}>
        <span className="max-[1080px]:hidden">{t("social.action.add")}</span>
      </Button>
      {vibe.sharing && (
        <>
          <Button size="sm" variant="outline" icon={<Share2 size={14} />} onClick={() => openPageDialog("share")} title={t("social.action.share")}>
            <span className="max-[1080px]:hidden">{t("social.action.share")}</span>
          </Button>
          <Button size="sm" variant="outline" icon={<PackageOpen size={14} />} onClick={() => openPageDialog("import")} title={t("social.action.import")}>
            <span className="max-[1080px]:hidden">{t("social.action.import")}</span>
          </Button>
        </>
      )}
      <DropdownMenu
        align="end"
        trigger={
          <IconButton label={t("social.chat.more")} size="sm">
            <Ellipsis size={15} />
          </IconButton>
        }
      >
        <DropdownItem icon={<ShieldOff size={14} />} onSelect={() => openPageDialog("blocked")}>
          {t("social.blocked.title")}
        </DropdownItem>
        <DropdownItem icon={<SettingsIcon size={14} />} onSelect={() => openSettings("vibe")}>
          {t("social.action.settings")}
        </DropdownItem>
      </DropdownMenu>
      <PageDialogs />
    </div>
  );
}

function PageDialogs() {
  const open = usePageDialog((s) => s.open);
  if (open === "add") return <AddFriendDialog />;
  if (open === "share") return <SharePackDialog />;
  if (open === "import") return <ImportPackDialog />;
  if (open === "blocked") return <BlockedDialog />;
  return null;
}

// ------------------------------------------------------------------ Postfach

function InboxButton() {
  const t = useT();
  const requests = useSocial((s) => s.requests);
  const invites = useSocial((s) => s.invites);
  const incoming = requests.filter((r) => r.direction === "incoming");
  const outgoing = requests.filter((r) => r.direction === "outgoing");
  const badge = incoming.length + invites.length;
  return (
    <Popover.Root>
      <Tooltip content={t("social.inbox.title")} side="bottom">
        <Popover.Trigger asChild>
          <button
            aria-label={t("social.inbox.title")}
            className={cn(
              "relative flex h-8 items-center gap-2 border px-2.5 text-[13px] font-semibold transition-colors duration-100",
              badge ? "border-brand/50 bg-brand/10 text-white hover:bg-brand/20" : "border-line2 text-muted hover:border-white/30 hover:text-white",
            )}
          >
            <Inbox size={15} />
            <span className="max-[1080px]:hidden">{t("social.inbox.title")}</span>
            {badge > 0 && (
              <span className="grid h-[18px] min-w-[18px] place-items-center bg-brand px-1 font-mono text-[10px] font-bold text-white">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[60] flex max-h-[min(560px,calc(100vh-120px))] w-[380px] flex-col border border-line2 bg-[#07070a] shadow-[0_16px_40px_rgba(0,0,0,.6)] data-[state=open]:animate-pop-in"
        >
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
            <Inbox size={14} className="text-muted" />
            <span className="flex-1 text-[13px] font-semibold text-white">{t("social.inbox.title")}</span>
          </div>
          <div className="scroll min-h-0 flex-1 pb-2">
            {!invites.length && !requests.length ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <span className="grid h-10 w-10 place-items-center border border-line2 bg-surface2 text-dim">
                  <Inbox size={18} />
                </span>
                <p className="text-[13px] font-semibold text-white">{t("social.inbox.empty")}</p>
                <p className="text-[12px] text-muted">{t("social.inbox.empty_text")}</p>
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

function InviteRow({ inv }: { inv: Invite }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-2 my-1 border border-line bg-surface/60 p-3">
      <div className="flex items-start gap-2.5">
        <Avatar user={inv.from} size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-white">{inv.target.name}</div>
          <div className="truncate text-[11.5px] text-dim">
            {t("social.accept.from", { name: inv.from.name })}
            {inv.target.mcVersion ? ` · ${inv.target.mcVersion}` : ""}
            {inv.target.loader ? ` ${inv.target.loader}` : ""}
          </div>
          {inv.message && <div className="mt-1.5 truncate text-[12px] italic text-muted">„{inv.message}“</div>}
        </div>
      </div>
      <div className="mt-2.5 flex justify-end gap-2">
        <Button
          size="sm"
          variant="subtle"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await requireClient().invites.decline(inv.id);
              removeInviteLocal(inv.id);
            } catch (e) {
              toast.error(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("social.invite.decline")}
        </Button>
        <Button size="sm" variant="primary" icon={<Mail size={13} />} onClick={() => openInviteAccept({ invite: inv })}>
          {t("social.invite.accept")}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Dialoge

function AddFriendDialog() {
  const t = useT();
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title={t("social.action.add")} description={t("social.add.desc")} size="sm">
      <AddFriendSearch />
    </Dialog>
  );
}

function BlockedDialog() {
  const t = useT();
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title={t("social.blocked.title")} description={t("social.blocked.desc")} size="sm">
      <BlockedList />
    </Dialog>
  );
}

function SharePackDialog() {
  const t = useT();
  const { data: instances = [], isLoading } = useInstances();
  const [q, setQ] = useState("");
  const list = instances.filter((i) => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title={t("social.action.share")} description={t("social.share.pick_desc")} size="md">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          {instances.length > 6 && (
            <SearchInput value={q} onChange={setQ} placeholder={t("social.share.pick_search")} aria-label={t("social.share.pick_search")} />
          )}
          <div className="max-h-[280px] overflow-y-auto border border-line bg-black/30">
            {isLoading ? (
              <div className="flex flex-col gap-1 p-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : !list.length ? (
              <p className="px-4 py-6 text-center text-[12.5px] text-dim">{instances.length ? t("social.add.none") : t("social.share.no_instances")}</p>
            ) : (
              list.map((i) => (
                <button
                  key={i.id}
                  onClick={() => {
                    close();
                    openShare(i.id);
                  }}
                  className="group flex h-14 w-full items-center gap-3 px-3 text-left transition-colors duration-100 hover:bg-white/[.04] [&+&]:border-t [&+&]:border-line"
                >
                  <InstanceIcon icon={i.icon} accent={instanceAccent(i.id, i.accent)} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-white">{i.name}</span>
                    <span className="block truncate font-mono text-[11px] text-dim">
                      {i.mc_version} · {i.loader.kind}
                    </span>
                  </span>
                  <ChevronRight size={15} className="text-dim transition-transform duration-100 group-hover:translate-x-0.5 group-hover:text-white" />
                </button>
              ))
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="label">{t("social.pack.title")}</span>
          <MyPacks />
        </div>
      </div>
    </Dialog>
  );
}

function MyPacks() {
  const t = useT();
  const q = useQuery({
    queryKey: vqk.packsMine,
    queryFn: () => requireClient().packs.mine(),
    staleTime: 60_000,
  });
  if (q.isLoading) return <Skeleton className="h-12" />;
  if (q.isError) return <p className="text-[12px] text-danger">{errText(q.error)}</p>;
  if (!q.data?.length) return <p className="border border-dashed border-line2 px-4 py-4 text-center text-[12.5px] text-dim">{t("social.pack.none_short")}</p>;
  return (
    <div className="border border-line bg-black/30">
      {q.data.map((p) => (
        <div key={p.id} className="flex items-center gap-3 px-3 py-2 [&+&]:border-t [&+&]:border-line">
          <PackIcon pack={p} size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white">{p.name}</div>
            <div className="truncate font-mono text-[11px] text-dim">
              {p.code} · {t(`social.share.vis.${p.visibility}`)} · {t("social.pack.downloads", { n: p.downloads })}
            </div>
          </div>
          <Tooltip content={t("social.share.copy_link")}>
            <IconButton label={t("social.share.copy_link")} size="sm" onClick={() => writeText(p.url).then(() => toast.success(t("social.copied"), p.url))}>
              <Copy size={14} />
            </IconButton>
          </Tooltip>
          <Tooltip content={t("social.pack.delete")}>
            <IconButton
              label={t("social.pack.delete")}
              size="sm"
              onClick={async () => {
                if (
                  !(await confirm({
                    title: t("social.pack.delete_q", { name: p.name }),
                    confirmLabel: t("social.pack.delete"),
                    danger: true,
                  }))
                )
                  return;
                try {
                  await requireClient().packs.delete(p.code);
                  q.refetch();
                } catch (e) {
                  toast.error(errText(e));
                }
              }}
            >
              <Trash2 size={14} />
            </IconButton>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}

/** Code aus Eingabe: „K7QX2M9P“, „https://vibe.henny.dev/p/K7QX2M9P“ oder „vibelauncher://pack/K7QX2M9P“. */
export function parsePackCode(v: string): string {
  const m = v.trim().match(/(?:\/p\/|pack\/)?([A-Za-z0-9]{4,16})\/?$/);
  return m ? m[1].toUpperCase() : "";
}

function ImportPackDialog() {
  const t = useT();
  const [code, setCode] = useState("");
  const c = parsePackCode(code);
  const submit = () => {
    if (!c) return;
    close();
    openPackImport(c);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={t("social.action.import")}
      description={t("social.import.desc")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={<ArrowRight size={14} />} disabled={!c} onClick={submit}>
            {t("social.import.next")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t("social.import.label")} hint={c ? t("social.import.detected", { code: c }) : t("social.import.hint")}>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("social.pack.code_ph")}
            className="font-mono text-[13px]"
            spellCheck={false}
            autoFocus
          />
        </Field>
      </form>
    </Dialog>
  );
}
