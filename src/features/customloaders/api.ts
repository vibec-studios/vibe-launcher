import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { loaderNames } from "@/lib/format";
import { queryClient, useSettings } from "@/lib/queries";
import type { CustomLoaderPack, Instance } from "@/lib/types";
import { customLoaderName } from "./labels";

export { customLoaderName, findPack, issueText, packsById, type Translate } from "./labels";

export const customLoadersKey = ["custom-loaders"] as const;

export function useCustomLoaders() {
  return useQuery({ queryKey: customLoadersKey, queryFn: api.customLoadersList, staleTime: 60_000 });
}

export function useCustomLoadersEnabled(): boolean {
  return useSettings().data?.custom_loaders === true;
}

export const refreshCustomLoaders = () => queryClient.invalidateQueries({ queryKey: customLoadersKey });

export function instanceLoaderText(i: Instance, packs: CustomLoaderPack[] | undefined): string {
  const custom = customLoaderName(i, packs);
  if (custom) return custom;
  return i.loader.kind === "vanilla" ? "Vanilla" : `${loaderNames[i.loader.kind]}${i.loader.version ? ` ${i.loader.version}` : ""}`;
}
