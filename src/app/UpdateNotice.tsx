// Launcher-Selbstupdate (Tauri-Updater, GitHub-Releases). Prüft einmal beim Start.
import { useEffect } from "react";
import { toast } from "@/components/ui";
import { t } from "@/i18n";
import { api } from "@/lib/api";

export function UpdateNotice() {
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const s = await api.settingsGet();
        if (!s.check_updates || cancelled) return;
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!update || cancelled) return;
        toast.info(t("update.available", { version: update.version }), update.body?.slice(0, 200), {
          label: t("update.install"),
          onClick: async () => {
            const id = toast.info(t("update.installing"));
            try {
              await update.downloadAndInstall();
              const { relaunch } = await import("@tauri-apps/plugin-process");
              await relaunch();
            } catch (e) {
              toast.dismiss(id);
              toast.error(e);
            }
          },
        });
      } catch (e) {
        console.warn("Update-Prüfung fehlgeschlagen", e);
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  return null;
}
