import type { ReactNode } from "react";
import { Brand, TopActions } from "@/components/TopActions";

export function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-bg">
      <div className="flex h-16 shrink-0 items-center px-5 sm:px-8">
        <Brand />
        <div className="ml-auto">
          <TopActions />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div className="hidden lg:block">{aside}</div>
          <div className="mx-auto w-full max-w-md rounded-panel bg-surface p-7 shadow-e2 sm:p-9">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function formatCode(v: string): string {
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

export function AsidePitch({ title, points }: { title: string; points: { icon: ReactNode; title: string; text: string }[] }) {
  return (
    <div className="pr-6">
      <h1 className="text-[34px] leading-tight font-bold tracking-tight">{title}</h1>
      <ul className="mt-8 flex flex-col gap-5">
        {points.map((p) => (
          <li key={p.title} className="flex gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-card bg-brand/14 text-accent">{p.icon}</span>
            <div>
              <div className="font-semibold">{p.title}</div>
              <div className="text-meta text-muted">{p.text}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
