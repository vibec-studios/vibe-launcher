import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { LibrarySkin, SkinProfile, SkinVariant } from "@/lib/types";
import { toast } from "@/components/ui";
import { t as tt } from "@/i18n";
import { sourceLabels, type ImportSource } from "./SkinImport";

export const DROP_ID = "skins-page";
export const skq = {
  profile: (accountId: string) => ["skins-profile", accountId] as const,
  library: ["skin-library"] as const,
};
export const isPng = (p: string) => p.toLowerCase().endsWith(".png");

/** Vorschau-Zustand: Skin aus der Bibliothek und/oder ein anderes Cape (undefined = unverändert). */
export interface Preview {
  skin?: LibrarySkin;
  variant?: SkinVariant;
  capeId?: string | null;
}

export function setProfile(p: SkinProfile) {
  queryClient.setQueryData(skq.profile(p.account_id), p);
}

export async function addFiles(paths: string[]) {
  const pngs = paths.filter(isPng);
  let ok = 0;
  for (const p of pngs) {
    try {
      await api.skinLibraryAddFile(p);
      ok++;
    } catch (e) {
      toast.error(e, tt("skins.error.library"));
    }
  }
  if (ok) {
    void queryClient.invalidateQueries({ queryKey: skq.library });
    toast.success(ok === 1 ? tt("skins.added") : tt("skins.added_n", { n: ok }));
  }
}

export function sourceLabel(src: string | null): string | null {
  if (!src) return null;
  if (src === "file") return tt("skins.source_file");
  if (src === "editor") return tt("skined.source_editor");
  const [kind, name] = [src.slice(0, src.indexOf(":")), src.slice(src.indexOf(":") + 1)];
  if (kind === "account") return tt("skins.source_account", { name });
  if (kind === "player") return tt("skins.source_player", { name });
  if (kind === "import" && name in sourceLabels) return tt("skins.source_import", { app: sourceLabels[name as ImportSource] });
  return null;
}
