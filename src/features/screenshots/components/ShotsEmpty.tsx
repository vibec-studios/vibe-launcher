import { CircleHelp, FolderOpen, Library } from "lucide-react";
import { openHelp } from "@/features/help/store";
import { api } from "@/lib/api";
import { Button, EmptyState, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { route } from "../layout";

export function ShotsEmpty({ instance, total, names }: { instance: string | undefined; total: number; names: Map<string, string> }) {
  const t = useT();
  const nav = route.useNavigate();
  if (instance && total > 0) {
    // Gefiltert, aber diese Instanz hat (noch) keine Aufnahmen: zurück zu allen bzw. in den Ordner
    return (
      <EmptyState
        className="mt-3 rounded-panel bg-surface"
        icon="camera"
        title={t("shots.empty_filtered.title", { name: names.get(instance) ?? t("shots.this_instance") })}
        text={t("shots.empty_filtered.text")}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={() => nav({ search: { instance: undefined }, replace: true })}>
              {t("shots.show_all")}
            </Button>
            <Button
              size="sm"
              variant="subtle"
              icon={<FolderOpen size={14} />}
              onClick={() => api.instanceOpenFolder(instance, "screenshots").catch((e) => toast.error(e))}
            >
              {t("common.open_folder")}
            </Button>
          </div>
        }
      />
    );
  }
  return (
    <EmptyState
      className="mt-3 rounded-panel bg-surface"
      icon="camera"
      title={t("shots.empty.title")}
      text={t("shots.empty.text")}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon={<Library size={15} />} onClick={() => nav({ to: "/instances" })}>
            {t("layout.go_library")}
          </Button>
          <Button variant="subtle" icon={<CircleHelp size={15} />} onClick={() => openHelp("gallery")}>
            {t("layout.howto")}
          </Button>
        </div>
      }
    />
  );
}
