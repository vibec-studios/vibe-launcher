import type { ReactNode } from "react";
import { Activity, ArrowLeft, Server, Settings } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "./ui";
import { Brand, TopActions } from "./TopActions";

export interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: ReactNode;
}

export function Shell({ nav, active, header, back, children, onLogout, account }: { nav: NavItem[]; active: string; header: ReactNode; back?: { href: string; label: string }; children: ReactNode; onLogout?: () => void; account?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col bg-bg md:w-60 md:border-r md:border-line">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Brand />
          <div className="ml-auto md:hidden">
            <TopActions onLogout={onLogout} account={account} />
          </div>
        </div>
        {back && (
          <a href={`#${back.href}`} className="mx-3 mb-2 hidden items-center gap-2 rounded-ctl px-2 py-1.5 text-meta text-muted hover:bg-white/[.05] hover:text-text md:flex">
            <ArrowLeft size={15} />
            {back.label}
          </a>
        )}
        <div className="hidden px-3 md:block">{header}</div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:mt-3 md:flex-col md:pb-0">
          {back && (
            <a href={`#${back.href}`} className="flex h-9 shrink-0 items-center gap-2 rounded-ctl px-3 text-[13.5px] text-muted md:hidden">
              <ArrowLeft size={16} />
            </a>
          )}
          {nav.map((n) => (
            <a
              key={n.key}
              href={`#${n.href}`}
              aria-current={n.key === active ? "page" : undefined}
              className={cn(
                "flex h-9 shrink-0 items-center gap-2.5 rounded-ctl px-3 text-[13.5px] font-medium transition-colors",
                n.key === active ? "bg-surface2 text-text" : "text-muted hover:bg-white/[.04] hover:text-text",
              )}
            >
              <span className={n.key === active ? "text-accent" : ""}>{n.icon}</span>
              {n.label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
        <div className="hidden h-14 shrink-0 items-center justify-end gap-2 px-6 md:flex">
          <TopActions onLogout={onLogout} account={account} />
        </div>
        <div className="md:hidden">{header && <div className="border-b border-line px-4 py-2">{header}</div>}</div>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-16 md:px-8 md:pt-2">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function useAgentNav(base: string): NavItem[] {
  const t = useT();
  return [
    { key: "servers", href: `${base}/servers`, label: t("nav.servers"), icon: <Server size={17} /> },
    { key: "resources", href: `${base}/resources`, label: t("nav.resources"), icon: <Activity size={17} /> },
    { key: "settings", href: `${base}/settings`, label: t("nav.settings"), icon: <Settings size={17} /> },
  ];
}

export function PageTitle({ title, desc, actions }: { title: ReactNode; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <h1 className="text-hero font-bold tracking-tight">{title}</h1>
        {desc && <p className="mt-1.5 max-w-2xl text-[13.5px] text-muted">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
