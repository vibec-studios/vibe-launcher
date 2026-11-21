import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSkinImportScan } from "@/features/skins/SkinImport";

export function useImportFinds(enabled: boolean) {
  const launchers = useQuery({ queryKey: ["launchers"], queryFn: api.launchersDetect, staleTime: 60_000, retry: 0, enabled });
  const skins = useSkinImportScan(enabled);
  const found = (launchers.data ?? []).filter((l) => l.instances.length > 0);
  const newSkins = skins.data?.new_count ?? 0;
  const pending = launchers.isPending || skins.isPending;
  return { found, newSkins, pending, any: found.length > 0 || newSkins > 0 };
}

export type ImportFinds = ReturnType<typeof useImportFinds>;
