import { Info } from "lucide-react";
import type { LoaderKind } from "@/lib/types";
import { loaderColors, loaderNames } from "@/lib/format";
import { VersionPicker, type VersionValue } from "@/components/instance/VersionPicker";
import { useT } from "@/i18n";
import { ChoiceCard } from "./ChoiceCard";
import { MOD_LOADERS, type Kind } from "./utils";

export function VersionStep({
  kind,
  ver,
  setVer,
  pickLoader,
}: {
  kind: Kind;
  ver: VersionValue;
  setVer: (v: VersionValue) => void;
  pickLoader: (l: Exclude<LoaderKind, "vanilla">) => void;
}) {
  const t = useT();
  return (
    <VersionPicker
      value={ver}
      onChange={setVer}
      listHeight={292}
      render={({ list, loaderVersion }) => (
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-7 max-[700px]:grid-cols-1">
          {list}
          <div className="flex flex-col gap-5">
            {kind === "mods" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="label">{t("newinst.loader")}</span>
                  <div role="radiogroup" aria-label={t("newinst.loader")} className="grid grid-cols-2 gap-2">
                    {MOD_LOADERS.map((l) => (
                      <ChoiceCard
                        key={l}
                        compact
                        icon={<span className="h-2.5 w-2.5 rounded-dot" style={{ background: loaderColors[l] }} />}
                        title={loaderNames[l]}
                        selected={ver.loader === l}
                        onSelect={() => pickLoader(l)}
                      />
                    ))}
                  </div>
                  <p className="text-[12px] leading-relaxed text-dim">{t("uic.srv.loader.hint")}</p>
                </div>
                {loaderVersion}
              </>
            ) : (
              <div className="flex items-start gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
                <Info size={15} className="mt-0.5 shrink-0 text-muted" />
                <p className="text-[12.5px] leading-relaxed text-muted">{t("uic.srv.vanilla.hint")}</p>
              </div>
            )}
          </div>
        </div>
      )}
    />
  );
}
