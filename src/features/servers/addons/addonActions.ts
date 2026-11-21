import { queryClient } from "@/lib/queries";
import type { Server } from "@/lib/types";
import { confirm, toast } from "@/components/ui";
import { t as tt } from "@/i18n";
import { addonApi, aqk, type Addon, type AddonList } from "../addonsApi";

export function refresh(id: string) {
  queryClient.invalidateQueries({ queryKey: aqk.addons(id) });
  queryClient.invalidateQueries({ queryKey: aqk.updates(id) });
}

export async function removeAddon(server: Server, a: Addon) {
  const ok = await confirm({
    title: tt("srv.addons.remove.title", {
      name: a.title ?? a.name ?? a.file_name,
    }),
    text: tt("srv.addons.remove.text"),
    confirmLabel: tt("common.delete"),
    danger: true,
  });
  if (!ok) return;
  try {
    await addonApi.remove(server.id, a.file_name);
    refresh(server.id);
  } catch (e) {
    toast.error(e);
  }
}

export async function toggleAddon(server: Server, a: Addon, on: boolean) {
  try {
    await addonApi.setEnabled(server.id, a.file_name, on);
    queryClient.setQueryData<AddonList>(
      aqk.addons(server.id),
      (l) =>
        l && {
          ...l,
          items: l.items.map((x) =>
            x.file_name === a.file_name
              ? {
                  ...x,
                  enabled: on,
                  file_name: on ? x.file_name.replace(/\.disabled$/, "") : `${x.file_name}.disabled`,
                }
              : x,
          ),
        },
    );
    refresh(server.id);
  } catch (e) {
    toast.error(e);
  }
}

export async function updateAddons(server: Server, files: string[] | null) {
  try {
    const n = await addonApi.update(server.id, files);
    toast.success(tt("srv.addons.updated", { n }), server.name);
  } catch (e) {
    toast.error(e, tt("srv.addons.update_failed"));
  } finally {
    refresh(server.id);
  }
}

export const folderOf = (s: Server) => (s.platform ? "plugins" : "mods");
