// „Spiel mit mir“-Link (`vibelauncher://join/<code>`, docs/PLAY-LINKS.md): Details laden, nachfragen, passende
// Instanz nehmen oder anlegen, dann per Quick Play direkt in die Welt des Hosts.
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, WifiOff } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useVibe } from "@/lib/vibe";
import { Button, Skeleton } from "@/components/ui";
import { useT } from "@/i18n";
import { JoinBody } from "./components/JoinBody";
import { Notice, Shell } from "./components/parts";
import { errKind } from "./utils";

export function PlayJoinDialog({ code, onDone }: { code: string; onDone: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const vibe = useVibe();
  const link = useQuery({ queryKey: ["play-link", code], queryFn: () => api.playLinkGet(code), retry: 0, staleTime: 30_000, enabled: vibe.enabled });

  if (!vibe.enabled) {
    return (
      <Shell title={t("play.title")} onClose={onDone}>
        <Notice tone="warn" icon={<WifiOff size={16} />} title={t("play.vibe_off")}>
          <Button size="sm" className="mt-3" onClick={() => (onDone(), nav({ to: "/settings", search: { tab: "vibe" } }))}>
            {t("action.open_settings")}
          </Button>
        </Notice>
      </Shell>
    );
  }
  if (link.isError) {
    const expired = errKind(link.error) === "not_found";
    return (
      <Shell title={expired ? t("play.expired.title") : t("play.title")} onClose={onDone} retry={expired ? undefined : () => link.refetch()}>
        {expired ? (
          <Notice tone="muted" icon={<Clock size={16} />} title={t("play.expired.text")}>
            <p className="mt-1 text-meta text-dim">{t("play.expired.hint")}</p>
          </Notice>
        ) : (
          <Notice tone="danger" icon={<AlertTriangle size={16} />} title={t("play.load_failed")}>
            <p className="selectable mt-1 text-meta text-dim">{errorMessage(link.error)}</p>
          </Notice>
        )}
      </Shell>
    );
  }
  if (!link.data) {
    return (
      <Shell title={t("play.title")} onClose={onDone}>
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-56" />
          </div>
        </div>
      </Shell>
    );
  }
  return <JoinBody link={link.data} onDone={onDone} />;
}
