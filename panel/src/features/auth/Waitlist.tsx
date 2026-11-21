import { Hourglass } from "lucide-react";
import { ApiError } from "@/api/transport";
import { WEB_LOGIN_PATH, vibeOrigin } from "@/api/gateway";
import { useT } from "@/i18n";
import { Button } from "@/components/ui";

export function isAccessError(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 403 && e.code.toUpperCase().startsWith("ACCESS_");
}

export function Waitlist({ error, onLogout }: { error: ApiError; onLogout?: () => void }) {
  const t = useT();
  const rejected = error.code.toUpperCase() === "ACCESS_REJECTED";
  return (
    <div className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-4 rounded-panel bg-surface p-8 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-warn/15 text-warn">
        <Hourglass size={26} />
      </span>
      <h1 className="text-title font-bold">{rejected ? t("wait.rejected_title") : t("wait.title")}</h1>
      <p className="text-[13.5px] text-muted">{rejected ? t("wait.rejected_desc") : t("wait.desc")}</p>
      <p className="text-meta text-dim">{error.message}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <a href={`${vibeOrigin()}${WEB_LOGIN_PATH}`} className="inline-flex h-10 items-center rounded-ctl bg-brand px-5 text-[13.5px] font-semibold text-[var(--ui-on-accent)] hover:brightness-110">
          {t("wait.status")}
        </a>
        {onLogout && (
          <Button variant="subtle" size="md" onClick={onLogout} className="h-10">
            {t("top.logout")}
          </Button>
        )}
      </div>
    </div>
  );
}
