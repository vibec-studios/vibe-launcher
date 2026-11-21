import { useMemo } from "react";
import { CheckCircle2, Download } from "lucide-react";
import type { JoinPreview } from "@/lib/types";
import { formatBytes } from "@/lib/format";
import { useT } from "@/i18n";
import { CLIENTS } from "../utils";

export function InstallPlan({ p }: { p: JoinPreview }) {
  const t = useT();
  const lines = useMemo(() => {
    const out: string[] = [];
    if (p.create) out.push(t("play.plan.create"));
    else if (p.instance_name) out.push(t("play.plan.use", { name: p.instance_name }));
    if (p.create && p.pack_title) out.push(t("play.plan.pack", { name: p.pack_title, n: p.pack_files }));
    if (p.pack_update && p.pack_title) out.push(t("pjoin.plan.update", { name: p.pack_title, from: p.pack_from_version ?? "?", to: p.pack_version ?? "?" }));
    if (p.pack_update) out.push(t("pjoin.plan.keep"));
    if (p.mods > 0) out.push(t("play.plan.mods", { n: p.mods }));
    if (p.client_pack) out.push(t("play.plan.client", { name: CLIENTS[p.client_pack] ?? p.client_pack }));
    if (p.game_download) out.push(t("play.plan.game"));
    return out;
  }, [p, t]);
  const nothing = !p.create && p.mods === 0 && !p.client_pack && !p.pack_update;
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{nothing ? t("play.plan.ready_title") : t("play.plan.title")}</span>
      <ul className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <li key={l} className="flex items-start gap-2 text-[13px] leading-snug text-text">
            <CheckCircle2 size={14} strokeWidth={2.25} className="mt-0.5 shrink-0 text-ok" />
            {l}
          </li>
        ))}
      </ul>
      {!nothing && (
        <div className="flex items-center gap-1.5 text-meta text-muted">
          <Download size={12} className="text-dim" />
          {p.download_bytes != null && p.download_bytes > 0
            ? t(p.game_download ? "play.size_plus_game" : "play.size", { size: formatBytes(p.download_bytes) })
            : p.vibe_pack
              ? t("pjoin.size_pack")
              : t("play.size_unknown")}
        </div>
      )}
    </div>
  );
}
