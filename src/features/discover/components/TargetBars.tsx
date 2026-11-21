import { Link } from "@tanstack/react-router";
import { ArrowLeft, X } from "lucide-react";
import { IconButton, Select, Skeleton } from "@/components/ui";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import { useT } from "@/i18n";
import { formatLoader } from "@/lib/format";
import { useJavaInstances } from "@/lib/queries";
import type { Instance, ProjectType } from "@/lib/types";
import { route } from "../constants";

/** Tab der Instanzseite, der zu einem Projekttyp gehört. */
export function instanceTabFor(type: ProjectType) {
  return type === "resourcepack" ? "resourcepacks" : type === "shader" ? "shaders" : "content";
}


/** Simple: „Wird installiert in: [Spiel]“ – Wechsel per Auswahl, Hinweis, dass nur Passendes erscheint. */
export function SimpleTargetBar({ target, options }: { target: Instance | null; options: Instance[] }) {
  const t = useT();
  const navigate = route.useNavigate();
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-6">
      {target ? <InstanceBadge instance={target} size={24} /> : <Skeleton className="h-6 w-6 rounded-ctl" />}
      <span className="shrink-0 text-[13px] text-muted">{t("sdisc.target")}</span>
      <div className="w-[240px] min-w-0">
        <Select
          size="sm"
          value={target?.id ?? null}
          placeholder={t("common.loading")}
          onChange={(id) => navigate({ search: (s) => ({ ...s, instance: id }), replace: true })}
          options={options.map((i) => ({ value: i.id, label: i.name }))}
        />
      </div>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-dim">{t("sdisc.target_hint")}</span>
    </div>
  );
}

export function TargetBanner({ instanceId, type }: { instanceId: string; type: ProjectType }) {
  const t = useT();
  const navigate = route.useNavigate();
  const { data: instances, isPending } = useJavaInstances();
  const inst = instances?.find((i) => i.id === instanceId);
  return (
    <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-6">
      {inst ? <InstanceBadge instance={inst} size={22} /> : <Skeleton className="h-[22px] w-[22px] rounded-ctl" />}
      <div className="min-w-0 flex-1 truncate text-[13px] text-muted">
        {isPending ? (
          t("common.loading")
        ) : inst ? (
          <>
            {t("discover.target_prefix")} <b className="font-semibold text-text">{inst.name}</b>
            <span className="ml-2 text-meta text-dim">{`${inst.mc_version} · ${formatLoader(inst.loader)}`}</span>
          </>
        ) : (
          t("discover.target_missing")
        )}
      </div>
      {inst && (
        <Link
          to="/instances/$id"
          params={{ id: inst.id }}
          search={{ tab: instanceTabFor(type) }}
          className="inline-flex h-8 items-center gap-1.5 rounded-ctl px-2.5 text-[13px] font-semibold text-muted transition-colors duration-150 hover:bg-white/[.06] hover:text-text"
        >
          <ArrowLeft size={14} />
          {t("discover.back_to_instance")}
        </Link>
      )}
      <IconButton
        label={t("discover.target_clear")}
        tip
        variant="ghost"
        size="sm"
        onClick={() => navigate({ search: (s) => ({ ...s, instance: undefined }), replace: true })}
      >
        <X size={15} />
      </IconButton>
    </div>
  );
}
