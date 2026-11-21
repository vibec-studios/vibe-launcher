import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Trash2, UserPlus } from "lucide-react";
import type { Invite, Role } from "@/api/types";
import { useAgent } from "@/app/agent";
import { dateTime } from "@/app/format";
import { useT } from "@/i18n";
import { Badge, Button, Card, CopyField, Dialog, Field, IconButton, Notice, Select, Spinner, toast, useConfirm } from "@/components/ui";

const ROLES: Exclude<Role, "owner">[] = ["admin", "operator", "viewer"];

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { api, remote } = useAgent();
  const [role, setRole] = useState<Exclude<Role, "owner">>("admin");
  const [invite, setInvite] = useState<Invite | null>(null);
  const create = useMutation({ mutationFn: () => api.invite(role), onSuccess: setInvite, onError: (e) => toast.error(e) });
  const close = () => {
    onClose();
    setTimeout(() => setInvite(null), 200);
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("users.invite_title")}
      desc={t("users.invite_desc")}
      footer={
        invite ? (
          <Button variant="primary" onClick={close}>
            {t("common.done")}
          </Button>
        ) : (
          <>
            <Button variant="subtle" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
              {t("users.invite_create")}
            </Button>
          </>
        )
      }
    >
      {invite ? (
        <div className="flex flex-col gap-4">
          <CopyField value={invite.code} big />
          <p className="text-[13.5px] text-muted">{t("users.invite_how", { url: remote ? "vibe.axolite.app/panel" : location.host })}</p>
          <p className="text-meta text-dim">{t("users.invite_expires", { when: dateTime(invite.expires_at) })}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label={t("users.role")}>
            <Select value={role} onChange={(e) => setRole(e.target.value as Exclude<Role, "owner">)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)} – {t(`role.${r}.desc`)}
                </option>
              ))}
            </Select>
          </Field>
          {remote && <Notice tone="info">{t("users.invite_remote")}</Notice>}
        </div>
      )}
    </Dialog>
  );
}

export function UsersCard() {
  const t = useT();
  const { api, key, me } = useAgent();
  const confirm = useConfirm();
  const [inviting, setInviting] = useState(false);
  const [pairCode, setPairCode] = useState<Invite | null>(null);
  const users = useQuery({ queryKey: [key, "users"], queryFn: api.users });
  const patch = useMutation({ mutationFn: (p: { id: string; role: Role }) => api.updateUser(p.id, { role: p.role }), onSuccess: () => (users.refetch(), toast.ok(t("common.saved"))), onError: (e) => toast.error(e) });
  const remove = useMutation({ mutationFn: (id: string) => api.removeUser(id), onSuccess: () => users.refetch(), onError: (e) => toast.error(e) });
  const newCode = useMutation({ mutationFn: () => api.pairCode(), onSuccess: setPairCode, onError: (e) => toast.error(e) });
  return (
    <Card
      title={t("users.title")}
      desc={t("users.desc")}
      actions={
        <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => setInviting(true)}>
          {t("users.invite")}
        </Button>
      }
    >
      {users.isLoading ? (
        <Spinner />
      ) : users.error ? (
        <Notice tone="danger">{(users.error as Error).message}</Notice>
      ) : (
        <ul>
          {users.data?.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand/15 font-semibold text-accent">{u.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {u.name}
                  {u.id === me.user.id && <Badge>{t("users.you")}</Badge>}
                  {u.vibe_user_id && <Badge tone="accent">Vibe</Badge>}
                </div>
                <div className="text-meta text-dim">{t("users.since", { when: dateTime(u.created_at) })}</div>
              </div>
              {u.role === "owner" ? (
                <Badge tone="ok">{t("role.owner")}</Badge>
              ) : (
                <>
                  <Select value={u.role} onChange={(e) => patch.mutate({ id: u.id, role: e.target.value as Role })} className="w-40">
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`role.${r}`)}
                      </option>
                    ))}
                  </Select>
                  <IconButton label={t("users.remove")} tone="danger" onClick={async () => (await confirm.ask({ title: t("users.remove_confirm", { name: u.name }), body: t("users.remove_desc"), confirm: t("users.remove"), danger: true })) && remove.mutate(u.id)}>
                    <Trash2 size={16} />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <div className="text-[13.5px] font-medium">{t("users.paircode")}</div>
          <div className="text-meta text-muted">{t("users.paircode_desc")}</div>
        </div>
        {pairCode ? <CopyField value={pairCode.code} className="sm:w-56" /> : <Button variant="ghost" icon={<KeyRound size={15} />} loading={newCode.isPending} onClick={() => newCode.mutate()}>{t("users.paircode_new")}</Button>}
      </div>
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      {confirm.node}
    </Card>
  );
}
