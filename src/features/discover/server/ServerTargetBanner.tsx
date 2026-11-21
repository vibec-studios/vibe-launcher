import { Link } from "@tanstack/react-router";
import { ArrowLeft, X } from "lucide-react";
import { IconButton, Skeleton } from "@/components/ui";
import { useT } from "@/i18n";
import { useTargetRunning } from "@/features/installtarget/hooks";
import type { ServerTargetInfo } from "@/features/installtarget/types";
import { route } from "../constants";
import { TargetIcon, softwareLabel } from "./parts";

export function ServerTargetBanner({ target, pending }: { target: ServerTargetInfo | null; pending: boolean }) {
  const t = useT();
  const navigate = route.useNavigate();
  const running = useTargetRunning(target);
  return (
    <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-6" data-testid="server-target-banner">
      {target ? <TargetIcon target={target} size={22} /> : <Skeleton className="h-[22px] w-[22px] rounded-ctl" />}
      <div className="min-w-0 flex-1 truncate text-[13px] text-muted">
        {target ? (
          <>
            {t("st.banner.prefix")} <b className="font-semibold text-text">{target.name}</b>
            <span className="ml-2 text-meta text-dim">
              {`${softwareLabel(target)} · Minecraft ${target.mc_version}`}
              {target.origin === "remote" ? ` · ${target.agentName ?? t("st.remote")}` : ""}
            </span>
            {running && <span className="ml-2 text-meta text-warn">{t("st.banner.running")}</span>}
          </>
        ) : pending ? (
          t("common.loading")
        ) : (
          t("st.missing.title")
        )}
      </div>
      {target?.origin === "local" && (
        <Link
          to="/servers/$id"
          params={{ id: target.id }}
          search={{ tab: "addons" }}
          className="inline-flex h-8 items-center gap-1.5 rounded-ctl px-2.5 text-[13px] font-semibold text-muted transition-colors duration-150 hover:bg-white/[.06] hover:text-text"
        >
          <ArrowLeft size={14} />
          {t("st.banner.back")}
        </Link>
      )}
      <IconButton label={t("st.banner.clear")} tip variant="ghost" size="sm" onClick={() => navigate({ search: (s) => ({ q: s.q }), replace: true })}>
        <X size={15} />
      </IconButton>
    </div>
  );
}
