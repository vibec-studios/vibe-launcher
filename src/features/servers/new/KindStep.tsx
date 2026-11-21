import { Box, Copy, Plug, Puzzle } from "lucide-react";
import { useT } from "@/i18n";
import { ChoiceCard } from "./ChoiceCard";
import type { Kind } from "./utils";

export function KindStep({ kind, hasInstances, pickKind }: { kind: Kind; hasInstances: boolean; pickKind: (k: Kind) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[15px] font-semibold text-text">{t("uic.srv.kind.q")}</h3>
      <div role="radiogroup" aria-label={t("uic.srv.kind.q")} className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
        <ChoiceCard
          icon={<Copy size={20} />}
          title={t("uic.srv.kind.instance")}
          text={hasInstances ? t("uic.srv.kind.instance.text") : t("uic.srv.kind.instance.none")}
          selected={kind === "instance"}
          disabled={!hasInstances}
          onSelect={() => pickKind("instance")}
        />
        <ChoiceCard icon={<Box size={20} />} title="Vanilla" text={t("uic.srv.kind.vanilla.text")} selected={kind === "vanilla"} onSelect={() => pickKind("vanilla")} />
        <ChoiceCard icon={<Puzzle size={20} />} title={t("uic.srv.kind.mods")} text={t("uic.srv.kind.mods.text")} selected={kind === "mods"} onSelect={() => pickKind("mods")} />
        <ChoiceCard icon={<Plug size={20} />} title={t("uic.srv.kind.plugins")} text={t("uic.srv.kind.plugins.text")} selected={kind === "plugins"} onSelect={() => pickKind("plugins")} />
      </div>
    </div>
  );
}
