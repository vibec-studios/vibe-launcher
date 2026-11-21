import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { formatBytes } from "@/lib/format";
import type { FeedbackPreview, FeedbackSendResult } from "@/lib/types";
import { useT } from "@/i18n";
import { ErrorBox } from "./ErrorBox";
import { LogBlock } from "./LogBlock";

// ------------------------------------------------------------------ Vorschau

function MetaRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[12px] text-dim">{k}</dt>
      <dd className="selectable min-w-0 break-words text-[12.5px] text-text">{children}</dd>
    </>
  );
}

export function PreviewStep({ p, error }: { p: FeedbackPreview; error: FeedbackSendResult | null }) {
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
