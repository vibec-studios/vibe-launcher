import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "./cn";

export function Card({ title, desc, actions, children, className, pad = true }: { title?: ReactNode; desc?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cn("rounded-card bg-surface", pad && "p-5", className)}>
      {(title || actions) && (
        <header className={cn("mb-3 flex items-start gap-3", !pad && "px-5 pt-5")}>
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-[15px] font-semibold text-text">{title}</h2>}
            {desc && <p className="mt-0.5 text-meta text-muted">{desc}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const tones = {
  ok: "bg-ok/12 text-ok",
  warn: "bg-warn/14 text-warn",
  danger: "bg-danger/14 text-danger",
  accent: "bg-brand/16 text-accent",
  muted: "bg-white/[.07] text-muted",
};

export function Badge({ tone = "muted", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-5.5 items-center gap-1 rounded-pill px-2 text-caption font-semibold whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Dot({ tone }: { tone: "ok" | "warn" | "danger" | "muted" }) {
  const c = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", muted: "bg-dim" }[tone];
  return <span className={cn("inline-block size-2 shrink-0 rounded-dot", c, tone === "ok" && "shadow-[0_0_0_3px_color-mix(in_srgb,var(--ui-ok)_22%,transparent)]")} />;
}

export function Notice({ tone = "info", title, children, actions }: { tone?: "info" | "warn" | "danger"; title?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  const Icon = tone === "info" ? Info : AlertTriangle;
  const c = { info: "bg-brand/10 text-accent", warn: "bg-warn/12 text-warn", danger: "bg-danger/12 text-danger" }[tone];
  return (
    <div className={cn("flex flex-col gap-3 rounded-card p-4 sm:flex-row sm:items-center", c)}>
      <Icon size={18} className="shrink-0" />
      <div className="min-w-0 flex-1 text-[13.5px]">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="text-text/85">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 text-dim">{icon}</div>}
      <div className="text-[15px] font-semibold">{title}</div>
      {children && <div className="max-w-md text-meta text-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Meter({ label, value, max, text, tone }: { label: ReactNode; value: number; max: number; text: ReactNode; tone?: "ok" | "warn" | "danger" }) {
  const f = max > 0 ? Math.min(1, value / max) : 0;
  const auto = tone ?? (f > 0.9 ? "danger" : f > 0.75 ? "warn" : "ok");
  const c = { ok: "bg-brand", warn: "bg-warn", danger: "bg-danger" }[auto];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-meta">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-text tabular-nums">{text}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-white/[.08]">
        <div className={cn("h-full rounded-pill transition-[width] duration-500", c)} style={{ width: `${Math.max(1.5, f * 100)}%` }} />
      </div>
    </div>
  );
}
