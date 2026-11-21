import { AlertTriangle, Check } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import { formatLoader } from "@/lib/format";
import type { Instance, ProjectHit } from "@/lib/types";
import { prettyLoader } from "@/components/content/Pill";
import { compatibility } from "@/components/content/util";
import { CategoryIcon, categoryLabel } from "../categoryIcons";

export interface CardProps {
  hit: ProjectHit;
  /** Ziel-Instanz-Modus */
  target: Instance | null;
  installed: boolean;
  instances: Instance[];
  onOpen: (hit: ProjectHit) => void;
}

export const LOADERS = ["fabric", "forge", "neoforge", "quilt"];

export function loadersOf(hit: ProjectHit) {
  return hit.project_type === "mod" || hit.project_type === "modpack" ? hit.loaders.filter((l) => LOADERS.includes(l)) : [];
}

/** Markenfarbe als CSS-Farbe (flach, ohne Verlauf). */
export function hitColor(hit: Pick<ProjectHit, "color">): string | null {
  return hit.color != null ? `#${hit.color.toString(16).padStart(6, "0")}` : null;
}


/** Kategorien als kleine Symbol-Etiketten (Symbol + Name), ruhig und einzeilig. */
export function CategoryTags({ hit, max = 3, iconsOnly }: { hit: ProjectHit; max?: number; iconsOnly?: boolean }) {
  const loaders = loadersOf(hit);
  return (
    <div className="flex min-w-0 items-center gap-x-2.5 gap-y-1 overflow-hidden text-[12px] text-muted">
      {loaders.length > 0 && <span className="shrink-0 font-medium text-text/90">{loaders.map(prettyLoader).join(" · ")}</span>}
      {hit.categories.slice(0, max).map((c) =>
        iconsOnly ? (
          <Tooltip key={c} content={categoryLabel(c)}>
            <span className="grid h-5 w-5 shrink-0 place-items-center text-dim">
              <CategoryIcon id={c} />
            </span>
          </Tooltip>
        ) : (
          <span key={c} className="flex shrink-0 items-center gap-1">
            <CategoryIcon id={c} className="text-dim" />
            {categoryLabel(c)}
          </span>
        ),
      )}
    </div>
  );
}

/** Passt das Projekt zur gewählten Instanz? (nur im Ziel-Instanz-Modus) */
export function CompatNote({ hit, target, installed }: { hit: ProjectHit; target: Instance; installed: boolean }) {
  const t = useT();
  if (hit.project_type === "modpack") return null;
  if (installed)
    return (
      <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-ok">
        <Check size={12} strokeWidth={2.5} />
        {t("discover.in_instance", { name: target.name })}
      </span>
    );
  const c = compatibility(hit, target);
  if (c.ok) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-[12px] text-warn">
      <AlertTriangle size={12} />
      {c.reason === "vanilla"
        ? t("install.incompat.vanilla")
        : c.reason === "loader"
          ? t("install.incompat.loader", { loader: formatLoader(target.loader) })
          : t("install.incompat.version", { version: target.mc_version })}
    </span>
  );
}

export function Stat({ icon, children, tip }: { icon: ReactNode; children: ReactNode; tip?: ReactNode }) {
  const el = (
    <span className="flex items-center gap-1.5 tabular-nums">
      <span className="text-dim">{icon}</span>
      {children}
    </span>
  );
  return tip ? <Tooltip content={tip}>{el}</Tooltip> : el;
}

export function useOpenProps(hit: ProjectHit, onOpen: (h: ProjectHit) => void) {
  const open = () => onOpen(hit);
  return {
    open,
    props: {
      role: "link",
      tabIndex: 0,
      onClick: open,
      onKeyDown: (e: KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && open(),
    },
  };
}
