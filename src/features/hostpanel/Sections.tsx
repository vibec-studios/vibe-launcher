import { useState } from "react";
import { Crown, DoorOpen, Globe, Lock, MoreHorizontal, ShieldCheck, Trash2, UserPlus, UserRound, Users } from "lucide-react";
import type { HostPanel, HostPrivacy, HostRole } from "@/lib/vibe-sdk";
import {
  Button,
  ChoiceCard,
  ChoiceGrid,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  EmptyState,
  IconButton,
  Input,
  NumberInput,
  Segmented,
  SettingRow,
  cn,
  toast,
} from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { formatRelative } from "@/lib/format";
import { requireClient } from "@/features/social/service";
import { useT } from "@/i18n";
import { hostError, panelAction } from "./api";
import { KickDialog } from "./KickDialog";

const ROLE_TONE: Record<HostRole, string> = { host: "bg-brand/15 text-brand", member: "bg-ok/10 text-ok", guest: "bg-surface2 text-muted" };

export function RoleTag({ role }: { role: HostRole }) {
  const t = useT();
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-pill px-2 text-caption font-semibold", ROLE_TONE[role])}>
      {role === "host" && <Crown size={11} />}
      {t(`hpanel.role.${role}`)}
    </span>
  );
}

async function run(id: string, fn: () => Promise<HostPanel>, ok?: string) {
  try {
    await panelAction(id, fn);
    if (ok) toast.success(ok);
  } catch (e) {
    toast.error(hostError(e));
  }
}

type Kick = { uuid: string | null; name: string } | null;

export function PlayersSection({ panel }: { panel: HostPanel }) {
  const t = useT();
  const id = panel.session.id;
  const host = panel.myRole === "host";
  const [kick, setKick] = useState<Kick>(null);
  const players = panel.players;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[14px] font-semibold text-text">{t("hpanel.players.title", { n: players.length })}</h3>
        {panel.policy.maxPlayers && <span className="text-caption tabular-nums text-dim">{t("hpanel.players.max", { n: panel.policy.maxPlayers })}</span>}
      </div>
      <div className="flex items-center gap-3 rounded-card bg-surface px-3 py-2.5">
        <PlayerHead uuid={panel.session.host.id} name={panel.session.host.name} size={30} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text">{panel.session.host.name}</span>
        <RoleTag role="host" />
      </div>
      {players.length === 0 ? (
        <EmptyState icon="friends" title={t("hpanel.players.empty")} text={t("hpanel.players.empty_text")} className="py-8" />
      ) : (
        <ul className="divide-y divide-line rounded-card bg-surface">
          {players.map((p) => (
            <li key={p.uuid ?? p.name} className="flex items-center gap-3 px-3 py-2">
              <PlayerHead uuid={p.uuid ?? ""} name={p.name} size={30} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-text">{p.name}</div>
                <div className="text-caption text-dim">{t("hpanel.players.since", { time: formatRelative(p.joinedAt) })}</div>
              </div>
              <RoleTag role={p.role} />
              {host && p.role !== "host" && (
                <DropdownMenu
                  trigger={
                    <IconButton label={t("hpanel.players.actions", { name: p.name })} variant="ghost" size="sm">
                      <MoreHorizontal size={15} />
                    </IconButton>
                  }
                >
                  {p.role !== "member" && (
                    <DropdownItem icon={<ShieldCheck size={14} />} onSelect={() => void run(id, () => requireClient().hosting.setMember(id, p.uuid ?? p.name, { role: "member", name: p.name }), t("hpanel.role.set_member", { name: p.name }))}>
                      {t("hpanel.players.make_member")}
                    </DropdownItem>
                  )}
                  {p.role !== "guest" && (
                    <DropdownItem icon={<UserRound size={14} />} onSelect={() => void run(id, () => requireClient().hosting.setMember(id, p.uuid ?? p.name, { role: "guest", name: p.name }), t("hpanel.role.set_guest", { name: p.name }))}>
                      {t("hpanel.players.make_guest")}
                    </DropdownItem>
                  )}
                  <DropdownSeparator />
                  <DropdownItem icon={<DoorOpen size={14} />} danger onSelect={() => setKick({ uuid: p.uuid, name: p.name })}>
                    {t("hpanel.players.kick")}
                  </DropdownItem>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      )}
      {kick && <KickDialog sessionId={id} player={kick} onClose={() => setKick(null)} />}
    </div>
  );
}

export function ListSection({ panel }: { panel: HostPanel }) {
  const t = useT();
  const id = panel.session.id;
  const host = panel.myRole === "host";
  const [name, setName] = useState("");
  const [role, setRole] = useState<"member" | "guest">("member");
  const [busy, setBusy] = useState(false);
  const valid = /^[A-Za-z0-9_]{3,16}$/.test(name.trim());
  const add = async () => {
    setBusy(true);
    await run(id, () => requireClient().hosting.setMember(id, name.trim(), { role, name: name.trim() }), t("hpanel.list.added", { name: name.trim() }));
    setName("");
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2 min-[760px]:grid-cols-3">
        {(["host", "member", "guest"] as const).map((r) => (
          <div key={r} className="rounded-card bg-surface px-3 py-2.5">
            <RoleTag role={r} />
            <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{t(`hpanel.role.${r}_text`)}</p>
          </div>
        ))}
      </div>
      {host && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void add();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, ""))} maxLength={16} placeholder={t("hpanel.list.name_ph")} className="min-w-[180px] flex-1" leading={<UserPlus size={14} />} />
          <Segmented
            size="md"
            value={role}
            onChange={setRole}
            label={t("hpanel.list.role")}
            items={[
              { value: "member", label: t("hpanel.role.member") },
              { value: "guest", label: t("hpanel.role.guest") },
            ]}
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!valid}>
            {t("hpanel.list.add")}
          </Button>
        </form>
      )}
      {panel.members.length === 0 ? (
        <p className="rounded-card bg-surface px-3 py-3 text-[13px] text-muted">{t("hpanel.list.empty")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-card bg-surface">
          {panel.members.map((m) => (
            <li key={m.uuid} className="flex items-center gap-3 px-3 py-2">
              <PlayerHead uuid={m.uuid} name={m.name} size={28} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">
                {m.name}
                {m.user && m.user.name !== m.name && <span className="ml-1.5 text-dim">({m.user.name})</span>}
              </span>
              {host ? (
                <Segmented
                  value={m.role}
                  onChange={(r) => void run(id, () => requireClient().hosting.setMember(id, m.uuid, { role: r, name: m.name }))}
                  label={t("hpanel.list.role")}
                  items={[
                    { value: "member", label: t("hpanel.role.member") },
                    { value: "guest", label: t("hpanel.role.guest") },
                  ]}
                />
              ) : (
                <RoleTag role={m.role} />
              )}
              {host && (
                <IconButton label={t("hpanel.list.remove", { name: m.name })} tip variant="ghost" size="sm" onClick={() => void run(id, () => requireClient().hosting.removeMember(id, m.uuid))}>
                  <Trash2 size={14} />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BansSection({ panel }: { panel: HostPanel }) {
  const t = useT();
  const id = panel.session.id;
  const host = panel.myRole === "host";
  if (!panel.kicks.length) return <EmptyState icon="ban" title={t("hpanel.bans.empty")} text={t("hpanel.bans.empty_text")} className="py-8" />;
  return (
    <ul className="divide-y divide-line rounded-card bg-surface">
      {panel.kicks.map((k) => (
        <li key={`${k.uuid ?? k.name}-${k.at}`} className="flex items-center gap-3 px-3 py-2.5">
          <PlayerHead uuid={k.uuid ?? ""} name={k.name} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium text-text">{k.name}</div>
            <div className="truncate text-caption text-dim">
              {k.permanent ? t("hpanel.bans.permanent") : t("hpanel.bans.round")} · {formatRelative(k.at)}
              {k.reason && <> · „{k.reason}“</>}
            </div>
          </div>
          {host && (
            <Button size="sm" variant="subtle" onClick={() => void run(id, () => requireClient().hosting.unkick(id, k.uuid ?? k.name), t("hpanel.bans.lifted", { name: k.name }))}>
              {t("hpanel.bans.lift")}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

const PRIVACY_ICON: Record<HostPrivacy, React.ReactNode> = { invite: <Lock size={18} />, friends: <Users size={18} />, public: <Globe size={18} /> };

export function PrivacySection({ panel }: { panel: HostPanel }) {
  const t = useT();
  const id = panel.session.id;
  const host = panel.myRole === "host";
  const p = panel.policy;
  const [max, setMax] = useState<number | null>(p.maxPlayers);
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-[14px] font-semibold text-text">{t("hpanel.privacy.title")}</h3>
        <ChoiceGrid columns={3}>
          {(["invite", "friends", "public"] as const).map((v) => (
            <ChoiceCard
              key={v}
              icon={PRIVACY_ICON[v]}
              title={t(`hpanel.privacy.${v}`)}
              text={t(`hpanel.privacy.${v}_text`)}
              selected={p.privacy === v}
              disabled={!host}
              onClick={() => p.privacy !== v && void run(id, () => requireClient().hosting.setPolicy(id, { privacy: v }), t("hpanel.privacy.saved"))}
            />
          ))}
        </ChoiceGrid>
      </section>
      <div className="flex flex-col divide-y divide-line rounded-card bg-surface">
        <SettingRow title={t("hpanel.privacy.default_role")} description={t("hpanel.privacy.default_role_hint")}>
          <Segmented
            value={p.defaultRole}
            onChange={(r) => void run(id, () => requireClient().hosting.setPolicy(id, { defaultRole: r }))}
            items={[
              { value: "guest", label: t("hpanel.role.guest"), disabled: !host },
              { value: "member", label: t("hpanel.role.member"), disabled: !host },
            ]}
          />
        </SettingRow>
        <SettingRow title={t("hpanel.privacy.max")} description={t("hpanel.privacy.max_hint")}>
          <div className="flex items-center gap-2">
            <NumberInput value={max} onChange={setMax} min={1} max={500} placeholder={t("hpanel.privacy.max_any")} disabled={!host} aria-label={t("hpanel.privacy.max")} />
            {host && max !== p.maxPlayers && (
              <Button size="sm" variant="primary" onClick={() => void run(id, () => requireClient().hosting.setPolicy(id, { maxPlayers: max }), t("hpanel.privacy.saved"))}>
                {t("common.save")}
              </Button>
            )}
          </div>
        </SettingRow>
      </div>
    </div>
  );
}
