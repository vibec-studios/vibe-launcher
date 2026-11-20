// „Neue Instanz“ → Bedrock: Kanal (normal/Preview), Profil (eigene Daten oder die normalen Bedrock-Daten) und – beim
// ersten Mal – vorhandene Welten übernehmen. Unter macOS/Linux sichtbar, aber ausgegraut mit Erklärung.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, FolderSync, Layers, Monitor, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useInstances } from "@/lib/queries";
import type { BedrockChannel, BedrockProfile } from "@/lib/types";
import { accentPalette, formatBytes } from "@/lib/format";
import { Button, Checkbox, Input, Skeleton, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { GroupField, IconPicker } from "@/features/instances/NewInstanceDialog";
import { bedrockApi, bqk, channelStatus, isBedrock, useBedrockStatus } from "./api";
import { NotInstalledNotice } from "./parts";

function Card({ on, onClick, icon, title, text, right, disabled }: { on: boolean; onClick: () => void; icon: React.ReactNode; title: string; text: string; right?: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 items-start gap-3 rounded-card p-3 text-left transition-colors duration-100 disabled:pointer-events-none disabled:opacity-45",
        on ? "bg-surface3 shadow-[inset_0_0_0_1px_var(--accent)]" : "bg-surface2 hover:bg-surface3",
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-ctl bg-black/30 text-text">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[13.5px] font-semibold leading-tight text-text">
          {title}
          {right}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-muted">{text}</span>
      </span>
      {on && <Check size={16} strokeWidth={2.5} className="shrink-0 text-accent" />}
    </button>
  );
}

export function NewBedrockTab({ onDone, onBusy }: { onDone: () => void; onBusy: (b: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const status = useBedrockStatus();
  const { data: instances = [] } = useInstances();
  const groups = useMemo(() => [...new Set(instances.map((i) => i.group).filter((g): g is string => !!g))].sort(), [instances]);
  const firstBedrock = !instances.some(isBedrock);

  const [channel, setChannel] = useState<BedrockChannel>("release");
  const [profile, setProfile] = useState<BedrockProfile>("shared");
  const [adopt, setAdopt] = useState(firstBedrock);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [accent, setAccent] = useState(() => accentPalette[Math.floor(Math.random() * accentPalette.length)]);
  const [group, setGroup] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cs = channelStatus(status.data, channel);
  const otherDrive = cs?.same_volume === false;
  useEffect(() => {
    if (otherDrive) setProfile("shared");
  }, [otherDrive]);
  const supported = status.data?.supported ?? true;
  const blocked = status.data?.blocked ?? null;
  const canAdopt = profile === "isolated" && !!cs?.has_data;
  const summary = useQuery({
    queryKey: ["bedrock-home", channel],
    queryFn: () => bedrockApi.homeSummary(channel),
    enabled: canAdopt,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (nameTouched) return;
    const base = channel === "preview" ? t("bedrock.name_preview") : t("bedrock.name");
    setName(adopt && canAdopt ? t("bedrock.new.name_adopted", { name: base }) : base);
  }, [channel, adopt, canAdopt, nameTouched, t]);

  const disabled = !supported || !!blocked;
  const valid = !disabled && name.trim().length > 0;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    onBusy(true);
    try {
      const inst = await bedrockApi.create({ name: name.trim(), channel, profile, adopt: adopt && canAdopt, accent, group: group.trim() || null });
      if (icon) await api.instanceSetIcon(inst.id, icon).catch((e) => toast.error(e, t("inst.icon.failed")));
      qc.invalidateQueries({ queryKey: qk.instances });
      qc.invalidateQueries({ queryKey: bqk.status });
      onDone();
      nav({ to: "/instances/$id", params: { id: inst.id }, search: { tab: "content" } });
      if (adopt && canAdopt) toast.info(t("bedrock.new.adopting"), t("bedrock.new.adopting_text"));
    } catch (e) {
      toast.error(e, t("newinst.failed"));
      setBusy(false);
      onBusy(false);
    }
  };

  if (!supported) {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
          <Monitor size={34} className="text-dim" />
          <div className="display text-[16px] text-text">{t("bedrock.unsupported.title")}</div>
          <p className="max-w-[460px] text-[13px] text-muted">{t("bedrock.unsupported.text")}</p>
        </div>
        <footer className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
          <Button variant="subtle" onClick={onDone}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled className="min-w-[140px]">
            {t("newinst.create")}
          </Button>
        </footer>
      </>
    );
  }

  return (
    <>
      <div
        className="flex min-h-0 flex-1 gap-6 px-6 pb-4 pt-5"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        {/* Links: Identität + kurze Erklärung */}
        <div className="flex w-[300px] shrink-0 flex-col gap-4">
          <div className="flex items-start gap-3">
            <IconPicker icon={icon} accent={accent} onIcon={setIcon} onAccent={setAccent} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                placeholder={t("bedrock.name")}
                maxLength={64}
                aria-label={t("newinst.name")}
                autoFocus
                className="font-semibold"
              />
              <GroupField value={group} onChange={setGroup} groups={groups} />
            </div>
          </div>
          <div className="rounded-card bg-surface2 p-3.5 text-[12.5px] leading-relaxed text-muted">
            <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-text">
              <Layers size={14} className="text-accent" />
              {t("bedrock.new.what_title")}
              <span className="rounded-full bg-warn/15 px-2 py-px text-[11px] font-medium text-warn">{t("bedrock.experimental")}</span>
            </div>
            {t("bedrock.new.what_text")}
            <span className="mt-1.5 block text-dim">{t("bedrock.experimental_text")}</span>
          </div>
        </div>

        {/* Rechts: Kanal, Profil, Übernahme */}
        <div className="scroll flex min-w-0 flex-1 flex-col gap-4">
          {blocked && <div className="rounded-card bg-danger/[.08] px-4 py-3 text-[12.5px] text-muted">{blocked}</div>}
          <div className="flex flex-col gap-1.5">
            <span className="label">{t("bedrock.new.channel")}</span>
            <div className="flex gap-2" role="radiogroup">
              {(["release", "preview"] as const).map((ch) => {
                const s = channelStatus(status.data, ch);
                return (
                  <Card
                    key={ch}
                    on={channel === ch}
                    onClick={() => setChannel(ch)}
                    icon={<span className="text-[15px] font-bold">{ch === "release" ? "B" : "P"}</span>}
                    title={t(`bedrock.channel.${ch}`)}
                    text={
                      !s ? "…" : s.installed ? (s.version ? t("bedrock.new.installed_v", { v: s.version }) : t("bedrock.new.installed")) : t("bedrock.new.not_installed")
                    }
                    disabled={disabled}
                  />
                );
              })}
            </div>
          </div>
          {status.isLoading ? <Skeleton className="h-14" /> : cs && !cs.installed && !blocked && <NotInstalledNotice channel={channel} />}

          <div className="flex flex-col gap-1.5">
            <span className="label">{t("bedrock.new.profile")}</span>
            <div className="flex gap-2" role="radiogroup">
              <Card
                on={profile === "shared"}
                onClick={() => setProfile("shared")}
                icon={<Copy size={16} />}
                title={t("bedrock.profile.shared")}
                text={t("bedrock.profile.shared_text")}
                disabled={disabled}
              />
              <Card
                on={profile === "isolated"}
                onClick={() => setProfile("isolated")}
                icon={<FolderSync size={16} />}
                title={t("bedrock.profile.isolated")}
                text={otherDrive ? t("bedrock.profile.isolated_other_drive") : t("bedrock.profile.isolated_text")}
                disabled={disabled || otherDrive}
              />
            </div>
          </div>

          {canAdopt && (
            <label className="flex cursor-pointer items-start gap-3 rounded-card bg-surface2 p-3.5">
              <Checkbox checked={adopt} onChange={setAdopt} label={t("bedrock.new.adopt")} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-text">{t("bedrock.new.adopt")}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                  {summary.data
                    ? t("bedrock.new.adopt_text", { worlds: summary.data.worlds, packs: summary.data.packs, size: formatBytes(summary.data.size) })
                    : t("bedrock.new.adopt_text_loading")}
                </span>
              </span>
            </label>
          )}
          {profile === "isolated" && (
            <p className="flex items-start gap-2 text-[12px] leading-snug text-dim">
              <ShieldCheck size={14} className="mt-px shrink-0 text-ok" />
              {t("bedrock.new.safety")}
            </p>
          )}
        </div>
      </div>

      <footer className="flex items-center gap-3 border-t border-line px-6 py-4">
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold text-text">
            {t("bedrock.new.summary", { channel: t(`bedrock.channel.${channel}`), profile: t(`bedrock.profile.${profile}`) })}
          </div>
          <div className="truncate text-[12px] text-muted">{adopt && canAdopt ? t("bedrock.new.after_adopt") : t("bedrock.new.after")}</div>
        </div>
        <Button variant="subtle" onClick={onDone} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={!valid} loading={busy} className="min-w-[140px]">
          {t("newinst.create")}
        </Button>
      </footer>
    </>
  );
}
