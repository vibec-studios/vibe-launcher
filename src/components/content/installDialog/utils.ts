import { useT } from "@/i18n";
import { formatLoader } from "@/lib/format";
import type { Instance, ProjectVersion } from "@/lib/types";
import type { Compat } from "../util";

export function reasonText(t: ReturnType<typeof useT>, c: Compat, inst: Instance) {
  if (c.ok) return null;
  if (c.reason === "vanilla") return t("install.incompat.vanilla");
  if (c.reason === "loader") return t("install.incompat.loader", { loader: formatLoader({ kind: inst.loader.kind, version: null }) });
  return t("install.incompat.version", { version: inst.mc_version });
}

export function versionOptions(t: ReturnType<typeof useT>, versions: ProjectVersion[]) {
  return versions.map((v) => ({
    value: v.id,
    label: v.name || v.version_number,
    hint: `${v.release_type !== "release" ? t(`versions.type.${v.release_type}`) + " · " : ""}${v.game_versions.slice(-1)[0] ?? ""}`,
  }));
}
