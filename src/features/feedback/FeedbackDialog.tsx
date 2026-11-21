// Feedback-/Fehlerbericht-Dialog: Eingabe → Vorschau (genau das, was gesendet wird) → Danke.
// Rust liest und bereinigt die Logs selbst und hält Screenshots nur im Speicher (commands/feedback.rs).
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { AlertTriangle, Bug, Check, ChevronDown, Copy, ImagePlus, Lightbulb, MessageCircle, MessageSquareWarning, ShieldCheck, WifiOff, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useInstances } from "@/lib/queries";
import { formatBytes } from "@/lib/format";
import { useVibe } from "@/lib/vibe";
import type { FeedbackKind, FeedbackPreview, FeedbackSendResult } from "@/lib/types";
import { Button, Checkbox, Dialog, Field, IconButton, Input, Select, Spinner, Textarea, Tooltip, cn, toast } from "@/components/ui";
import { useLang, useT } from "@/i18n";
import { copyText } from "@/features/files/util";
import { closeFeedback, openFeedback, resetFeedback, setFeedback, useFeedback } from "./store";

const MIN = 10;
const MAX = 5000;
const CONTACT_MAX = 200;

type Step = { s: "edit" } | { s: "preview"; p: FeedbackPreview; error: FeedbackSendResult | null } | { s: "done"; ticket: string };

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "vibe.axolite.app";
  }
}

/** Angemeldetes Vibe-Konto (nur wenn Vibe an ist), sonst null. */
function useFeedbackAccount(): string | null {
  const vibe = useVibe();
  const status = useQuery({ queryKey: ["vibe-status-feedback"], queryFn: api.vibeStatus, enabled: vibe.enabled, staleTime: 30_000 });
  return vibe.enabled && status.data?.logged_in ? (status.data.identity?.name ?? null) : null;
}

export function FeedbackDialog() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const open = useFeedback((s) => s.open);
  const message = useFeedback((s) => s.message);
  const contact = useFeedback((s) => s.contact);
  const account = useFeedbackAccount();
  const [step, setStep] = useState<Step>({ s: "edit" });
  const [busy, setBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const n = message.trim().length;
  const canNext = n >= MIN && n <= MAX && contact.trim().length <= CONTACT_MAX;

  const next = async () => {
    const f = useFeedback.getState();
    setBusy(true);
    setEditErr(null);
    try {
      const p = await api.feedbackPreview({
        kind: f.kind,
        message: f.message,
        contact: f.contact.trim() || null,
        locale: lang,
        page: path,
        instance_id: f.instanceId,
        attach_logs: f.attachLogs,
        screenshots: [...(f.attachWindow && f.windowShot ? [f.windowShot.id] : []), ...f.files.map((x) => x.id)],
        link_account: !!account && f.linkAccount,
      });
      setStep({ s: "preview", p, error: null });
    } catch (e) {
      setEditErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  // Beim Öffnen immer bei der Eingabe beginnen (außer direkt nach „Danke“)
  useEffect(() => {
    if (open) setStep((st) => (st.s === "done" ? { s: "edit" } : st));
  }, [open]);

  const title = step.s === "preview" ? t("fb.preview.title") : step.s === "done" ? t("fb.done.title") : t("fb.title");
  const host = step.s === "preview" ? hostOf(step.p.endpoint) : "vibe.axolite.app";
  const desc = step.s === "preview" ? t("fb.preview.desc", { host }) : step.s === "done" ? undefined : t("fb.desc");

  const send = async (p: FeedbackPreview) => {
    setBusy(true);
    try {
      const r = await api.feedbackSend(p.token);
      if (r.status === "sent") {
        resetFeedback();
        setStep({ s: "done", ticket: r.ticket });
      } else setStep({ s: "preview", p, error: r });
    } catch (e) {
      // Vorschau abgelaufen o. Ä. -> zurück zur Eingabe, Entwurf bleibt
      toast.error(errorMessage(e));
      setStep({ s: "edit" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && closeFeedback()}
      title={
        <span className="flex items-center gap-2">
          {step.s === "done" ? <Check size={18} className="text-ok" /> : <MessageSquareWarning size={18} className="text-brand" />}
          {title}
        </span>
      }
      description={desc}
      size="lg"
      locked={busy}
      footer={
        step.s === "edit" ? (
          <>
            <p className="mr-auto flex min-w-0 flex-1 items-start gap-2 pr-2 text-[12px] text-dim">
              <ShieldCheck size={14} className="mt-px shrink-0" />
              {t("fb.target", { host: "vibe.axolite.app" })}
            </p>
            <Button variant="subtle" onClick={closeFeedback}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!canNext} loading={busy} onClick={next} data-testid="fb-next">
              {t("fb.next")}
            </Button>
          </>
        ) : step.s === "preview" ? (
          <>
            <Button variant="subtle" disabled={busy} onClick={() => setStep({ s: "edit" })}>
              {t("fb.back")}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => send(step.p)} data-testid="fb-send">
              {step.error ? t("fb.retry") : t("fb.send")}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={closeFeedback}>
            {t("common.close")}
          </Button>
        )
      }
    >
      {step.s === "edit" && <EditStep error={editErr} account={account} />}
      {step.s === "preview" && <PreviewStep p={step.p} error={step.error} />}
      {step.s === "done" && <DoneStep ticket={step.ticket} />}
    </Dialog>
  );
}

// ------------------------------------------------------------------ Eingabe

function KindCard({ value, icon, label }: { value: FeedbackKind; icon: ReactNode; label: string }) {
  const kind = useFeedback((s) => s.kind);
  const on = kind === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={() => setFeedback({ kind: value })}
      className={cn(
        "flex h-11 flex-1 items-center justify-center gap-2 rounded-ctl text-[13.5px] font-semibold transition-colors duration-100",
        on ? "bg-brand/15 text-text shadow-[inset_0_0_0_1.5px_var(--color-brand)]" : "bg-field text-muted hover:bg-white/[.07] hover:text-text",
      )}
    >
      <span className={on ? "text-brand" : undefined}>{icon}</span>
      {label}
    </button>
  );
}

function EditStep({ error, account }: { error: string | null; account: string | null }) {
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

function CheckRow({
  checked,
  onChange,
  title,
  desc,
  disabled,
  aside,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  desc?: string;
  disabled?: boolean;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-3 px-3.5 py-2.5", disabled && "opacity-60")}>
      <Checkbox checked={checked} disabled={disabled} onChange={onChange} label={title} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="text-left text-[13.5px] font-medium text-text">
          {title}
        </button>
        {desc && <div className="text-[12px] text-muted">{desc}</div>}
        {children}
      </div>
      {aside}
    </div>
  );
}

// ------------------------------------------------------------------ Vorschau

function MetaRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[12px] text-dim">{k}</dt>
      <dd className="selectable min-w-0 break-words text-[12.5px] text-text">{children}</dd>
    </>
  );
}

function ErrorBox({ r }: { r: FeedbackSendResult }) {
  const t = useT();
  let text = "";
  let icon = <AlertTriangle size={15} className="mt-px shrink-0" />;
  if (r.status === "offline") {
    text = t("fb.err.offline");
    icon = <WifiOff size={15} className="mt-px shrink-0" />;
  } else if (r.status === "rate_limited") {
    const mins = r.retry_after_secs ? Math.ceil(r.retry_after_secs / 60) : 0;
    text = t("fb.err.rate", { time: mins > 1 ? t("fb.err.rate_min", { n: mins }) : t("fb.err.rate_soon") });
  } else if (r.status === "rejected") {
    if (r.http === 413) text = t("fb.err.too_large");
    else if (r.http >= 500 || r.http === 0) text = t("fb.err.server", { code: r.http || "–" });
    else text = t("fb.err.rejected", { msg: r.message ?? `HTTP ${r.http}` });
  }
  return (
    <div role="alert" className={cn("flex items-start gap-2.5 rounded-card px-3.5 py-2.5 text-[12.5px]", r.status === "rate_limited" ? "bg-warn/10 text-warn" : "bg-danger/[.08] text-danger")}>
      {icon}
      <span className="text-text">{text}</span>
    </div>
  );
}

function PreviewStep({ p, error }: { p: FeedbackPreview; error: FeedbackSendResult | null }) {
  const t = useT();
  const m = p.meta as Record<string, unknown> & { instance?: Record<string, unknown> | null };
  const inst = m.instance;
  const kindLabel = t(`fb.kind.${String(m.kind)}`);
  return (
    <div className="flex flex-col gap-4 pb-1">
      {error && <ErrorBox r={error} />}
      <section>
        <h3 className="label mb-1.5">{t("fb.preview.meta")}</h3>
        <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5 rounded-card bg-surface/60 px-4 py-3">
          <MetaRow k={t("fb.meta.kind")}>{kindLabel}</MetaRow>
          <MetaRow k={t("fb.meta.message")}>
            <span className="whitespace-pre-wrap">{String(m.message)}</span>
          </MetaRow>
          {m.contact ? <MetaRow k={t("fb.meta.contact")}>{String(m.contact)}</MetaRow> : null}
          <MetaRow k={t("fb.meta.version")}>
            {String(m.version)} · {String(m.channel)}
          </MetaRow>
          <MetaRow k={t("fb.meta.os")}>
            {String(m.os)} · {String(m.arch)}
          </MetaRow>
          <MetaRow k={t("fb.meta.locale")}>{String(m.locale)}</MetaRow>
          {m.page ? <MetaRow k={t("fb.meta.page")}>{String(m.page)}</MetaRow> : null}
          {inst ? (
            <MetaRow k={t("fb.meta.instance")}>
              Minecraft {String(inst.mc_version)} · {String(inst.loader)}
              {inst.loader_version ? ` ${String(inst.loader_version)}` : ""} · {t("fb.meta.mods", { n: Number(inst.mod_count ?? 0) })}
              {inst.java ? ` · ${String(inst.java)}` : ""}
            </MetaRow>
          ) : null}
          <MetaRow k={t("fb.preview.account")}>{p.account ? t("fb.preview.linked", { name: p.account }) : t("fb.preview.anonymous")}</MetaRow>
        </dl>
      </section>
      <section>
        <h3 className="label mb-1.5">{t("fb.preview.logs")}</h3>
        {p.logs.length ? (
          <div className="flex flex-col gap-1.5">
            {p.logs.map((l, i) => (
              <LogBlock key={l.name} l={l} initiallyOpen={i === 0} />
            ))}
          </div>
        ) : (
          <div className="text-[12.5px] text-dim">{t("fb.preview.none")}</div>
        )}
      </section>
      <section>
        <h3 className="label mb-1.5">{t("fb.preview.shots")}</h3>
        {p.screenshots.length ? (
          <div className="flex flex-wrap gap-2">
            {p.screenshots.map((s) => (
              <figure key={s.id} className="flex flex-col gap-1">
                <img src={s.thumb} alt={s.name} className="h-24 rounded-xs object-cover shadow-e1" />
                <figcaption className="font-mono text-[11px] text-dim">
                  {s.name} · {s.width}×{s.height} · {formatBytes(s.bytes)}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="text-[12.5px] text-dim">{t("fb.preview.none")}</div>
        )}
      </section>
      <div className="flex items-center gap-2 text-[12px] text-dim">
        <ShieldCheck size={14} />
        <span className="flex-1">POST {p.endpoint}</span>
        <span className="tabular-nums">{t("fb.preview.total", { size: formatBytes(p.total_bytes) })}</span>
      </div>
    </div>
  );
}

function LogBlock({ l, initiallyOpen }: { l: FeedbackPreview["logs"][number]; initiallyOpen: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="overflow-hidden rounded-card bg-surface/60">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left hover:bg-white/[.03]">
        <ChevronDown size={14} className={cn("shrink-0 text-dim transition-transform", !open && "-rotate-90")} />
        <span className="font-mono text-[12.5px] font-medium text-text">{l.name}</span>
        <span className="text-[12px] tabular-nums text-dim">{formatBytes(l.bytes)}</span>
        {l.truncated && <span className="text-[11.5px] text-dim">· {t("fb.preview.truncated", { from: formatBytes(l.original_bytes) })}</span>}
        <span className="flex-1" />
        <span className={cn("inline-flex items-center gap-1 text-[11.5px]", l.redactions ? "text-ok" : "text-dim")}>
          <ShieldCheck size={12} />
          {l.redactions === 1 ? t("fb.preview.redacted_one") : l.redactions ? t("fb.preview.redacted", { n: l.redactions }) : t("fb.preview.redacted_none")}
        </span>
      </button>
      {open && (
        <pre className="selectable scroll max-h-56 overflow-auto whitespace-pre-wrap break-all bg-black/25 px-3.5 py-2.5 font-mono text-[11.5px] leading-[1.55] text-muted">
          {highlight(l.text)}
        </pre>
      )}
    </div>
  );
}

/** Ersetzte Stellen (<user>, <ip>, …) hervorheben. */
function highlight(text: string): ReactNode[] {
  const parts = text.split(/(<(?:user|host|ip|email|token|redacted)>)/g);
  return parts.map((s, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-[3px] bg-ok/15 px-0.5 text-ok">
        {s}
      </mark>
    ) : (
      s
    ),
  );
}

// ------------------------------------------------------------------ Danke

function DoneStep({ ticket }: { ticket: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3 px-4 pb-4 pt-2 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-pill bg-ok/15 text-ok">
        <Check size={28} strokeWidth={2.5} />
      </div>
      <p className="text-[15px] font-semibold text-text">
        {renderTicketSentence(t("fb.done.text", { ticket: "\u0000" }), ticket)}
      </p>
      <div className="flex items-center gap-2 rounded-ctl bg-field py-1 pl-3 pr-1">
        <span className="selectable font-mono text-[15px] font-semibold tracking-wide text-text" data-testid="fb-ticket">
          {ticket}
        </span>
        <Tooltip content={copied ? t("fb.done.copied") : t("fb.done.copy")} side="top">
          <IconButton
            label={t("fb.done.copy")}
            size="sm"
            variant="ghost"
            onClick={async () => {
              await copyText(ticket);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
          </IconButton>
        </Tooltip>
      </div>
      <p className="max-w-[420px] text-[12.5px] text-muted">{t("fb.done.hint")}</p>
    </div>
  );
}

function renderTicketSentence(s: string, ticket: string): ReactNode {
  const [a, b] = s.split("\u0000");
  return (
    <>
      {a}
      <span className="font-mono text-brand">{ticket}</span>
      {b}
    </>
  );
}

// ------------------------------------------------------------------ Einstiegspunkte

/** Knopf in der Titelleiste (auch im Simple-Modus). Wählt die Instanz der aktuellen Seite vor. */
export function FeedbackButton() {
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const instId = path.startsWith("/instances/") ? decodeURIComponent(path.split("/")[2] ?? "") : null;
  return (
    <Tooltip content={t("fb.button")} side="bottom">
      <button
        aria-label={t("fb.button")}
        data-testid="fb-open"
        data-tour="feedback"
        onClick={() => void openFeedback({ source: "button", ...(instId ? { instanceId: instId } : {}) })}
        className="grid h-8 w-8 place-items-center rounded-ctl text-muted transition-colors duration-100 hover:bg-white/[.06] hover:text-text"
      >
        <MessageSquareWarning size={16} />
      </button>
    </Tooltip>
  );
}

/** „Problem melden“ (Absturzanzeige, Autofix): öffnet den Dialog mit Instanz + Logs. */
export function ReportProblemButton({ instanceId, source = "crash", size = "sm" }: { instanceId: string; source?: "crash" | "autofix"; size?: "sm" | "md" }) {
  const t = useT();
  return (
    <Button size={size} variant="subtle" icon={<MessageSquareWarning size={13} />} onClick={() => void openFeedback({ kind: "bug", instanceId, attachLogs: true, source })}>
      {t("fb.crash.report")}
    </Button>
  );
}
