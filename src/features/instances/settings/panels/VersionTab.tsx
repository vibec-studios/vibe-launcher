import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { loaderNames } from "@/lib/format";
import { Button, SettingRow, SettingsCard } from "@/components/ui";
import { VersionPicker, type VersionValue } from "@/components/instance/VersionPicker";
import { useRunPhase } from "@/components/instance/status";
import { useT } from "@/i18n";
import { ClientPacks, useClientPacks } from "../ClientPacks";
import { VersionMigration } from "../VersionMigration";
import type { TabProps } from "./types";
import { instanceLoaderText, useCustomLoaders } from "@/features/customloaders/api";
import { InstanceLoaderIcon } from "@/features/customloaders/LoaderBadge";

// ------------------------------------------------------------------ Version & Loader

export function VersionTab({ instance: i }: TabProps) {
  const t = useT();
  const { phase } = useRunPhase(i.id);
  const [editing, setEditing] = useState(false);
  const [ver, setVer] = useState<VersionValue>({ mc: i.mc_version, loader: i.loader.kind, loaderVersion: i.loader.version });
  const packs = useClientPacks(i);
  const installedPacks = (packs.data?.packs ?? []).filter((p) => p.installed);
  const customPacks = useCustomLoaders().data;
  const changed = ver.mc !== i.mc_version || ver.loader !== i.loader.kind || (ver.loader !== "vanilla" && ver.loaderVersion !== i.loader.version);
  const valid = !!ver.mc && (ver.loader === "vanilla" || !!ver.loaderVersion);

  const target = ver.mc && valid ? { mc_version: ver.mc, loader: { kind: ver.loader, version: ver.loader === "vanilla" ? null : ver.loaderVersion } } : null;

  return (
    <SettingsCard title={t(editing ? "isd.version.configure" : "isd.section.installed")}>
      {!editing ? (
        // „Ändern“ gehört zur Zeile, nicht in die Abschnitts-Überschrift
        <>
        {i.custom_loader && (
          <SettingRow icon={<InstanceLoaderIcon instance={i} size={22} />} title={t("cl.instance.title", { name: instanceLoaderText(i, customPacks) })} description={t("cl.instance.desc")} />
        )}
        <SettingRow title={`Minecraft ${i.mc_version}`} description={i.custom_loader ? instanceLoaderText(i, customPacks) : i.loader.kind === "vanilla" ? "Vanilla" : `${loaderNames[i.loader.kind]} ${i.loader.version ?? ""}`}>
          <Button
            disabled={phase !== "idle"}
            onClick={() => {
              setVer({ mc: i.mc_version, loader: i.loader.kind, loaderVersion: i.loader.version });
              setEditing(true);
            }}
          >
            {t("isettings.version.change")}
          </Button>
        </SettingRow>
        </>
      ) : (
        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex items-start gap-3 rounded-card border border-warn/30 bg-warn/[.06] px-4 py-3 text-[14px] text-warn">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              {t("isettings.version.warn")}
              {i.custom_loader && ` ${t("cl.instance.switch")}`}
              {installedPacks.length > 0 && ` ${t("isd.version.packs", { list: installedPacks.map((p) => t(`cp.${p.id}.name`)).join(", ") })}`}
            </span>
          </div>
          <VersionMigration id={i.id} target={target} disabled={!changed || phase !== "idle"} onCancel={() => setEditing(false)} onDone={() => setEditing(false)}>
            <VersionPicker value={ver} onChange={setVer} listHeight={300} />
          </VersionMigration>
        </div>
      )}
    </SettingsCard>
  );
}

// ------------------------------------------------------------------ Client

export function ClientTab({ instance }: TabProps) {
  const t = useT();
  return (
    <>
      <p className="px-1 text-[13px] text-muted">{t("cp.lead")}</p>
      <ClientPacks instance={instance} />
    </>
  );
}
