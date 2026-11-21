import { Info } from "lucide-react";
import { Segmented } from "@/components/ui";
import { useT } from "@/i18n";
import { INSTALL_COMMANDS, type InstallOs } from "../install";
import { CommandBox } from "./CommandBox";

export function InstallStep({ os, onOs }: { os: InstallOs; onOs: (o: InstallOs) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13.5px] leading-relaxed text-muted">{t("rmt.install.lead")}</p>
      <Segmented<InstallOs>
        size="md"
        value={os}
        onChange={onOs}
        label={t("rmt.step.install")}
        items={[
          { value: "linux", label: t("rmt.install.linux") },
          { value: "windows", label: t("rmt.install.windows") },
          { value: "docker", label: t("rmt.install.docker") },
        ]}
      />
      <div className="flex flex-col gap-2">
        {INSTALL_COMMANDS[os].map((c) => (
          <CommandBox key={c} command={c} />
        ))}
        <p className="text-[12.5px] text-dim">{t(`rmt.install.${os}.hint`)}</p>
      </div>
      <InstallNotes />
    </div>
  );
}

function InstallNotes() {
  const t = useT();
  return (
    <div className="flex items-start gap-2.5 rounded-card bg-surface px-3.5 py-3 text-[12.5px] leading-relaxed text-muted">
      <Info size={15} className="mt-0.5 shrink-0 text-accent" />
      <div className="flex flex-col gap-1">
        <span>{t("rmt.install.ports")}</span>
        <span>{t("rmt.install.pair_again")}</span>
      </div>
    </div>
  );
}
