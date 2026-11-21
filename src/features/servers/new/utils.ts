import type { LoaderKind } from "@/lib/types";
import { loaderNames } from "@/lib/format";
import type { VersionValue } from "@/components/instance/VersionPicker";
import type { PlatformValue } from "../PlatformPicker";
import { platformNames } from "../addonsApi";

export type Kind = "instance" | "vanilla" | "mods" | "plugins";
export const DEFAULT_PORT = 25565;
export const DEFAULT_RAM = 2048;
export const MOD_LOADERS: Exclude<LoaderKind, "vanilla">[] = ["fabric", "neoforge", "forge", "quilt"];

export function suggestPluginName(p: PlatformValue): string {
  return p.mc ? `${platformNames[p.kind]}-Server ${p.mc}` : "";
}

export function suggestName(v: VersionValue): string {
  if (!v.mc) return "";
  return v.loader === "vanilla" ? `Server ${v.mc}` : `${loaderNames[v.loader]}-Server ${v.mc}`;
}
