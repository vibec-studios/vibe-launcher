import { useState } from "react";
import { Button, Dialog, Field, Input, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { useFriends } from "../hooks";
import { errText, openSocial, requireClient, useSocial } from "../service";
import { FriendChecklist, NeedLogin, useReady } from "./common";

// ------------------------------------------------------------------ Gruppen

export function GroupDialog({ chatId, onClose }: { chatId?: string; onClose: () => void }) {
  const t = useT();
  const ready = useReady();
  const friends = useFriends();
  const chat = useSocial((s) => (chatId ? s.chats[chatId] : undefined));
  const memberIds = new Set(chat?.members.map((m) => m.user.id) ?? []);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  if (!ready) return <NeedLogin title={t("social.group.new")} onClose={onClose} />;
  const submit = async () => {
    setBusy(true);
    try {
      const c = requireClient();
      if (chatId) await c.chats.addMembers(chatId, [...picked]);
      else {
        const ch = await c.chats.createGroup(name.trim(), [...picked]);
        useSocial.setState({ chats: { ...useSocial.getState().chats, [ch.id]: ch } });
        openSocial(ch.id);
      }
      onClose();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const list = friends.filter((f) => !memberIds.has(f.user.id));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={chatId ? t("social.group.add_members") : t("social.group.new")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={chatId ? picked.size === 0 : !name.trim()}>
            {chatId ? t("social.group.add") : t("social.group.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!chatId && (
          <Field label={t("social.group.name")}>
            <Input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label={t("social.invite.friends")}>
          <FriendChecklist friends={list} picked={picked} onPick={setPicked} className="scroll max-h-60 rounded-card bg-surface py-1" emptyText={t("social.friends.empty")} />
        </Field>
      </div>
    </Dialog>
  );
}
