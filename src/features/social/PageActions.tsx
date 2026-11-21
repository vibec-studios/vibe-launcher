// Aktionen der Freunde-Seite: Werkzeugleiste der Übersicht (Teilen, Importieren, ⋯, „Freund hinzufügen“),
// Postfach (Anfragen + Einladungen als Popover) und die Popups „Freund hinzufügen“, „Modpack teilen“,
// „Modpack per Code/Link importieren“ und „Blockierte Nutzer“.
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { copyText as writeText } from "@/components/content/util";
import { ArrowRight, Check, ChevronRight, Copy, Inbox, MoreHorizontal, PackageOpen, Settings as SettingsIcon, Share2, ShieldOff, Trash2, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { create } from "zustand";
import {
  Button,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  Dialog,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  Field,
  IconButton,
  Input,
  SearchInput,
  Section,
  Skeleton,
  Spinner,
  confirm,
  toast,
} from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { useT } from "@/i18n";
import { instanceAccent, loaderNames } from "@/lib/format";
import type { LoaderKind } from "@/lib/types";
import { useJavaInstances } from "@/lib/queries";
import { useVibe } from "@/lib/vibe";
import { parseInviteCode } from "@/lib/domains";
import { enqueueAppAction } from "@/lib/appActions";
import type { Invite, Pack } from "@/lib/vibe-sdk";
import { openSettings } from "@/features/settings/store";
import { AddFriendSearch, Avatar, BlockedList, GroupLabel, RequestRow } from "./FriendsList";
import { PackIcon } from "./dialogs";
import { openInviteAccept, openPackImport, openShare } from "./dialogStore";
import { errText, removeInviteLocal, requireClient, useSocial, vqk } from "./service";

type PageDialog = "add" | "share" | "import" | "blocked" | null;
const usePageDialog = create<{ open: PageDialog }>(() => ({ open: null }));
export const openPageDialog = (open: PageDialog) => usePageDialog.setState({ open });
const close = () => usePageDialog.setState({ open: null });

/** Rechte Seite der Werkzeugleiste: selten Gebrauchtes als Symbol bzw. im ⋯-Menü, „Freund hinzufügen“ als Hauptaktion. */
export function SocialActions({ showAdd = true }: { showAdd?: boolean }) {
  const t = useT();
  const vibe = useVibe();
  return (
    <div className="flex items-center gap-2">
      {vibe.sharing && (
        <>
          <IconButton label={t("social.action.share")} tip variant="ghost" onClick={() => openPageDialog("share")}>
            <Share2 size={15} />
          </IconButton>
          <IconButton label={t("social.action.import")} tip variant="ghost" onClick={() => openPageDialog("import")}>
            <PackageOpen size={15} />
          </IconButton>
        </>
      )}
      <DropdownMenu
        align="end"
        trigger={
          <IconButton label={t("social.chat.more")} tip variant="ghost">
            <MoreHorizontal size={16} />
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
      {showAdd && (
        <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => openPageDialog("add")}>
          {t("social.action.add")}
        </Button>
      )}
    </div>
  );
}

/** Einmal auf der Seite eingebunden (unabhängig davon, ob Übersicht oder Chat offen ist). */
export function PageDialogs() {
  const open = usePageDialog((s) => s.open);
  if (open === "add") return <AddFriendDialog />;
  if (open === "share") return <SharePackDialog />;
  if (open === "import") return <ImportPackDialog />;
  if (open === "blocked") return <BlockedDialog />;
  return null;
}

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

/** Einladung im Postfach: sichtbar „Annehmen“ (öffnet den Annehmen-Dialog), Ablehnen im ⋯-Menü und per Rechtsklick. */
function InviteRow({ inv }: { inv: Invite }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const accept = () => openInviteAccept({ invite: inv });
  const decline = async () => {
    setBusy(true);
    try {
      await requireClient().invites.decline(inv.id);
      removeInviteLocal(inv.id);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ContextMenu
      content={
        <>
          <ContextItem icon={<Check size={14} />} onSelect={accept}>
            {t("social.invite.accept")}
          </ContextItem>
          <ContextSeparator />
          <ContextItem icon={<X size={14} />} onSelect={() => void decline()}>
            {t("social.invite.decline")}
          </ContextItem>
        </>
      }
    >
      <div className="mx-1.5 flex items-start gap-2.5 rounded-ctl px-2 py-2 transition-colors duration-100 hover:bg-white/[.04] data-[state=open]:bg-white/[.04]">
        <Avatar user={inv.from} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight text-text">{inv.target.name}</div>
          <div className="truncate text-caption text-dim">
            {t("social.accept.from", { name: inv.from.name })}
            {inv.target.mcVersion ? ` · ${inv.target.mcVersion}` : ""}
            {inv.target.loader ? ` ${loaderNames[inv.target.loader as LoaderKind] ?? inv.target.loader}` : ""}
          </div>
          {inv.message && <div className="mt-1 truncate text-[12px] italic text-muted">„{inv.message}“</div>}
        </div>
        {busy ? (
          <span className="grid h-8 w-8 place-items-center">
            <Spinner size={12} />
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={accept}>
            {t("social.invite.accept")}
          </Button>
        )}
        <DropdownMenu
          align="end"
          trigger={
            <IconButton label={t("social.chat.more")} variant="ghost" size="sm" disabled={busy}>
              <MoreHorizontal size={15} />
            </IconButton>
          }
        >
          <DropdownItem icon={<Check size={14} />} onSelect={accept}>
            {t("social.invite.accept")}
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<X size={14} />} onSelect={() => void decline()}>
            {t("social.invite.decline")}
          </DropdownItem>
        </DropdownMenu>
      </div>
    </ContextMenu>
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
  const { data: instances = [], isLoading } = useJavaInstances();
  const [q, setQ] = useState("");
  const list = instances.filter((i) => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title={t("social.action.share")} description={t("social.share.pick_desc")} size="md">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          {instances.length > 6 && (
            <SearchInput value={q} onChange={setQ} placeholder={t("social.share.pick_search")} aria-label={t("social.share.pick_search")} />
          )}
          <div className="scroll max-h-[280px] rounded-card bg-surface">
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
                  className="group flex h-12 w-full items-center gap-3 border-line px-3 text-left transition-colors duration-100 hover:bg-white/[.04] [&+&]:border-t"
                >
                  <InstanceIcon icon={i.icon} seed={i.id} accent={instanceAccent(i.id, i.accent)} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold leading-tight text-text">{i.name}</span>
                    <span className="block truncate text-caption text-dim">
                      {i.mc_version} · {loaderNames[i.loader.kind]}
                    </span>
                  </span>
                  <ChevronRight size={15} className="text-dim transition-colors duration-100 group-hover:text-text" />
                </button>
              ))
            )}
          </div>
        </div>
        <Section title={t("social.pack.title")}>
          <MyPacks />
        </Section>
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
  if (!q.data?.length) return <p className="rounded-card bg-surface px-4 py-4 text-center text-[12.5px] text-dim">{t("social.pack.none_short")}</p>;
  return (
    <div className="rounded-card bg-surface">
      {q.data.map((p) => (
        <PackRow key={p.id} pack={p} onDeleted={() => q.refetch()} />
      ))}
    </div>
  );
}

/** Eigenes Pack: sichtbar „Link kopieren“, Löschen im ⋯-Menü und per Rechtsklick. */
function PackRow({ pack: p, onDeleted }: { pack: Pack; onDeleted: () => void }) {
  const t = useT();
  const copy = () => void writeText(p.url).then(() => toast.success(t("social.copied"), p.url));
  const remove = async () => {
    if (!(await confirm({ title: t("social.pack.delete_q", { name: p.name }), confirmLabel: t("social.pack.delete"), danger: true }))) return;
    try {
      await requireClient().packs.delete(p.code);
      onDeleted();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <ContextMenu
      content={
        <>
          <ContextItem icon={<Copy size={14} />} onSelect={copy}>
            {t("social.share.copy_link")}
          </ContextItem>
          <ContextSeparator />
          <ContextItem icon={<Trash2 size={14} />} danger onSelect={() => void remove()}>
            {t("social.pack.delete")}
          </ContextItem>
        </>
      }
    >
      <div className="flex items-center gap-3 border-line px-3 py-2 data-[state=open]:bg-white/[.04] [&+&]:border-t">
        <PackIcon pack={p} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight text-text">{p.name}</div>
          <div className="truncate text-caption text-dim">
            <span className="font-mono">{p.code}</span> · {t(`social.share.vis.${p.visibility}`)} · {t("social.pack.downloads", { n: p.downloads })}
          </div>
        </div>
        <IconButton label={t("social.share.copy_link")} tip variant="ghost" size="sm" onClick={copy}>
          <Copy size={14} />
        </IconButton>
        <DropdownMenu
          align="end"
          trigger={
            <IconButton label={t("social.chat.more")} variant="ghost" size="sm">
              <MoreHorizontal size={15} />
            </IconButton>
          }
        >
          <DropdownItem icon={<Copy size={14} />} onSelect={copy}>
            {t("social.share.copy_link")}
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<Trash2 size={14} />} danger onSelect={() => void remove()}>
            {t("social.pack.delete")}
          </DropdownItem>
        </DropdownMenu>
      </div>
    </ContextMenu>
  );
}


/** Code aus Eingabe: „K7QX2M9P“, „https://vibe.axolite.app/p/K7QX2M9P“ (auch alte Adresse) oder „vibelauncher://pack/K7QX2M9P“. */
export function parsePackCode(v: string): string {
  const m = v.trim().match(/(?:\/p\/|pack\/)?([A-Za-z0-9]{4,16})\/?$/);
  return m ? m[1].toUpperCase() : "";
}

function ImportPackDialog() {
  const t = useT();
  const [code, setCode] = useState("");
  // Eingefügter Einladungslink (https://axolite.cc/j/…, alt https://vibe.henny.dev/j/…) -> Spiel beitreten
  const join = parseInviteCode(code);
  const c = join ? "" : parsePackCode(code);
  const submit = () => {
    if (join) {
      close();
      enqueueAppAction({ kind: "play_link", code: join });
      return;
    }
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
          <Button variant="primary" icon={<ArrowRight size={14} />} disabled={!c && !join} onClick={submit}>
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
        <Field label={t("social.import.label")} hint={join ? t("social.import.detected_join", { code: join }) : c ? t("social.import.detected", { code: c }) : t("social.import.hint")}>
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
