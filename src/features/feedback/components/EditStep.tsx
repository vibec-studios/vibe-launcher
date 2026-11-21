import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bug, ImagePlus, Lightbulb, MessageCircle, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useInstances } from "@/lib/queries";
import { formatBytes } from "@/lib/format";
import { Button, Field, Input, Select, Spinner, Textarea, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { setFeedback, useFeedback } from "../store";
import { CONTACT_MAX, MAX, MIN } from "../utils";
import { CheckRow } from "./CheckRow";
import { KindCard } from "./KindCard";

export function EditStep({ error, account }: { error: string | null; account: string | null }) {
  const t = useT();
  const f = useFeedback();
  const { data: instances = [] } = useInstances();
  const logs = useQuery({ queryKey: ["feedback-logs", f.instanceId], queryFn: () => api.feedbackLogs(f.instanceId), enabled: f.attachLogs, staleTime: 5_000 });
  const [picking, setPicking] = useState(false);
  const n = f.message.trim().length;
  const shots = (f.attachWindow && f.windowShot ? 1 : 0) + f.files.length;

  const pick = async () => {
    setPicking(true);
    try {
      const r = await api.feedbackPickScreenshots(t("fb.files.pick_title"));
      const room = 3 - shots;
      const take = r.images.slice(0, Math.max(0, room));
      const drop = r.images.slice(take.length).map((i) => i.id);
      if (drop.length) {
        void api.feedbackDiscard(drop);
        toast.error(t("fb.files.max"));
      }
      for (const e of r.errors) toast.error(e);
      if (take.length) setFeedback({ files: [...useFeedback.getState().files, ...take] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPicking(false);
    }
  };

  const msgLabel = f.kind === "idea" ? t("fb.message.idea") : f.kind === "other" ? t("fb.message.other") : t("fb.message");
  return (
    <div className="flex flex-col gap-4 pb-1">
      {(f.source === "crash" || f.source === "autofix") && (
        <div className="flex items-start gap-2.5 rounded-card bg-danger/[.08] px-3.5 py-2.5 text-[12.5px] text-text">
          <AlertTriangle size={15} className="mt-px shrink-0 text-danger" />
          {t(f.source === "crash" ? "fb.source.crash" : "fb.source.autofix")}
        </div>
      )}
      <div className="flex gap-2" role="radiogroup">
        <KindCard value="bug" icon={<Bug size={16} />} label={t("fb.kind.bug")} />
        <KindCard value="idea" icon={<Lightbulb size={16} />} label={t("fb.kind.idea")} />
        <KindCard value="other" icon={<MessageCircle size={16} />} label={t("fb.kind.other")} />
      </div>
      <Field
        label={msgLabel}
        hint={
          <span className="flex">
            <span className="flex-1">{n > 0 && n < MIN ? t("fb.message.min", { n: MIN - n }) : ""}</span>
            <span className={cn("tabular-nums", n > MAX && "text-danger")}>
              {n} / {MAX}
            </span>
          </span>
        }
      >
        <Textarea
          autoFocus
          value={f.message}
          maxLength={MAX + 200}
          spellCheck
          onChange={(e) => setFeedback({ message: e.target.value })}
          placeholder={t(`fb.message.ph.${f.kind}`)}
          className="min-h-28"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("fb.contact")} hint={t("fb.contact.hint")}>
          <Input value={f.contact} maxLength={CONTACT_MAX} onChange={(e) => setFeedback({ contact: e.target.value })} placeholder={t("fb.contact.ph")} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="label">{t("fb.instance")}</span>
          <Select
            value={f.instanceId ?? "__none"}
            onChange={(v) => setFeedback({ instanceId: v === "__none" ? null : v })}
            options={[{ value: "__none", label: t("fb.instance.none") }, ...instances.map((i) => ({ value: i.id, label: i.name, hint: i.bedrock ? "Bedrock" : i.mc_version }))]}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="label">{t("fb.attach")}</span>
        <div className="flex flex-col divide-y divide-line rounded-card bg-surface/60">
          <CheckRow checked={f.attachLogs} onChange={(v) => setFeedback({ attachLogs: v })} title={t("fb.logs")} desc={t("fb.logs.desc")}>
            {f.attachLogs && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {logs.isLoading ? (
                  <Spinner size={12} />
                ) : logs.data?.length ? (
                  logs.data.map((l) => (
                    <span key={l.name} className="inline-flex h-6 items-center gap-1.5 rounded-xs bg-white/[.06] px-2 font-mono text-[11.5px] text-muted">
                      {l.name}
                      <span className="text-dim">{formatBytes(l.bytes)}</span>
                    </span>
                  ))
                ) : (
                  <span className="text-[12px] text-dim">{t("fb.logs.none")}</span>
                )}
              </div>
            )}
          </CheckRow>
          <CheckRow
            checked={f.attachWindow && !!f.windowShot}
            disabled={!f.windowShot}
            onChange={(v) => setFeedback({ attachWindow: v })}
            title={t("fb.window")}
            desc={f.windowShot ? t("fb.window.desc") : t("fb.window.unavailable")}
            aside={f.windowShot && <img src={f.windowShot.thumb} alt="" className={cn("h-14 rounded-xs object-cover shadow-e1 transition-opacity", !f.attachWindow && "opacity-40")} />}
          />
          <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
            {f.files.map((img) => (
              <div key={img.id} className="group relative">
                <img src={img.thumb} alt={img.name} title={`${img.name} · ${formatBytes(img.bytes)}`} className="h-14 rounded-xs object-cover shadow-e1" />
                <button
                  aria-label={t("fb.files.remove")}
                  onClick={() => {
                    void api.feedbackDiscard([img.id]);
                    setFeedback({ files: useFeedback.getState().files.filter((x) => x.id !== img.id) });
                  }}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-pill bg-overlay text-muted shadow-e2 hover:text-text"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<ImagePlus size={13} />} loading={picking} disabled={shots >= 3} onClick={pick}>
              {t("fb.files.add")}
            </Button>
            {shots >= 3 && <span className="text-[12px] text-dim">{t("fb.files.max")}</span>}
          </div>
          {account && (
            <CheckRow checked={f.linkAccount} onChange={(v) => setFeedback({ linkAccount: v })} title={t("fb.account", { name: account })} desc={t("fb.account.desc")} />
          )}
        </div>
      </div>

      {error && <div className="selectable rounded-card bg-danger/[.08] px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
    </div>
  );
}
