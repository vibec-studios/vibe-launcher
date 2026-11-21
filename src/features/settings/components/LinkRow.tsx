import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

export function LinkRow({ href, icon, title, text }: { href: string; icon: ReactNode; title: string; text: string }) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 px-4 py-3 transition-colors duration-100 first:rounded-t-card last:rounded-b-card hover:bg-white/[.03] [&+&]:border-t [&+&]:border-line"
    >
      <span className="text-dim group-hover:text-text">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-text">{title}</span>
        <span className="block truncate text-meta text-muted">{text}</span>
      </span>
      <ExternalLink size={13} className="text-dim group-hover:text-text" />
    </a>
  );
}
