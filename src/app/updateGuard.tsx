import { api } from "@/lib/api";
import type { UpdateBlockers } from "@/lib/types";
import { confirm, toast } from "@/components/ui";
import { t } from "@/i18n";

function GuardText({ b }: { b: UpdateBlockers }) {
  return (
    <div className="flex flex-col gap-2">
      <p>{t("update.guard.text")}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {b.servers > 0 && <li>{b.servers === 1 ? t("update.guard.servers_one") : t("update.guard.servers", { n: b.servers })}</li>}
        {b.games > 0 && <li>{b.games === 1 ? t("update.guard.games_one") : t("update.guard.games", { n: b.games })}</li>}
        {b.tasks.length > 0 && (
          <li>
            {t("update.guard.tasks")} {b.tasks.join(", ")}
          </li>
        )}
      </ul>
    </div>
  );
}

export async function askUpdateGuard(): Promise<boolean | null> {
  const b = await api.updateBlockers();
  if (b.bedrock_swap) {
    toast.error(t("update.guard.bedrock_title"), t("update.guard.bedrock"));
    return null;
  }
  if (b.servers === 0 && b.games === 0 && b.tasks.length === 0) return false;
  const ok = await confirm({
    title: t("update.guard.title"),
    text: <GuardText b={b} />,
    confirmLabel: t("update.guard.confirm"),
    cancelLabel: t("update.guard.later"),
  });
  return ok ? true : null;
}
