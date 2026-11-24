import { PackagePlus, Trash2 } from "lucide-react";
import { Button, EmptyState, IconButton, SettingRow, Skeleton, Switch, Tooltip, confirm, toast } from "@/components/ui";
import type { TabProps } from "@/features/settings/types";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatBytes, loaderNames } from "@/lib/format";
import type { CustomLoaderPack } from "@/lib/types";
import { refreshCustomLoaders, useCustomLoaders } from "./api";
import { CustomLoaderImportHost, pickCustomLoader } from "./ImportDialog";
import { PackIcon } from "./LoaderBadge";

function PackRow({ p }: { p: CustomLoaderPack }) {
  const t = useT();
  const remove = async () => {
    const ok = await confirm({ title: t("cl.delete.title", { name: p.name, version: p.loader_version }), text: t("cl.delete.text"), danger: true, confirmLabel: t("cl.delete") });
    if (!ok) return;
    try {
      await api.customLoaderDelete(p.id, p.loader_version);
      await refreshCustomLoaders();
    } catch (e) {
      toast.error(e, t("cl.delete.failed"));
    }
  };
  const meta = [
    p.author ? t("cl.by", { author: p.author }) : null,
    `Minecraft ${p.minecraft.join(", ")}`,
    p.mods === "vanilla" ? t("cl.mods.none") : t("cl.mods.for", { loader: loaderNames[p.mods] }),
    formatBytes(p.size_bytes),
    t("cl.instances", { n: p.instances }),
  ].filter((x): x is string => !!x);
  const del = (
    <IconButton label={t("cl.delete")} onClick={remove} disabled={p.instances > 0}>
      <Trash2 size={16} />
    </IconButton>
  );
  return (
    <SettingRow
      icon={<PackIcon src={p.icon_path} size={28} />}
      title={
        <span>
          {p.name} <span className="font-normal text-muted">{p.loader_version}</span>
        </span>
      }
      description={meta.join(" · ")}
    >
      {p.instances > 0 ? <Tooltip content={t("cl.delete.in_use", { n: p.instances })}><span>{del}</span></Tooltip> : del}
    </SettingRow>
  );
}

function Manager() {
  const t = useT();
  const packs = useCustomLoaders();
  return (
    <>
      <SettingRow title={t("cl.manage")} description={t("cl.manage.desc")}>
        <Button icon={<PackagePlus size={16} />} onClick={() => void pickCustomLoader()}>{t("cl.import")}</Button>
      </SettingRow>
      {packs.isLoading ? (
        <div className="px-4 py-3"><Skeleton className="h-10" /></div>
      ) : packs.data?.length ? (
        packs.data.map((p) => <PackRow key={`${p.id}@${p.loader_version}`} p={p} />)
      ) : (
        <EmptyState className="py-6" title={t("cl.empty")} text={t("cl.empty.text")} />
      )}
      <CustomLoaderImportHost />
    </>
  );
}

export function CustomLoadersRows({ s, update }: TabProps) {
  const t = useT();
  const on = s.custom_loaders === true;
  return (
    <>
      <SettingRow title={t("cl.setting")} description={t("cl.setting.desc")}>
        <Switch checked={on} onChange={(custom_loaders) => update({ custom_loaders })} label={t("cl.setting")} />
      </SettingRow>
      {on && <Manager />}
    </>
  );
}
