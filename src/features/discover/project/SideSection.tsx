import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { openExternal } from "@/components/content/util";

export function SideSection({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-text">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function SideLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      onClick={() => void openExternal(href)}
      className="group -mx-2 flex h-8 items-center gap-2.5 rounded-ctl px-2 text-left text-[13px] text-muted transition-colors hover:bg-white/[.05] hover:text-text"
    >
      <span className="text-dim transition-colors group-hover:text-text">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      <ExternalLink size={12} className="text-dim opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
