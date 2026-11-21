import { Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { Select, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import type { Source, StoreInfo } from "@/lib/types";
import { route } from "../constants";

export function SourcePicker({ sourceValue, cfAvailable, sysPending, apiKeys, enabledStores }: { sourceValue: Source; cfAvailable: boolean; sysPending: boolean; apiKeys: boolean; enabledStores: StoreInfo[] }) {
  const t = useT();
  const navigate = route.useNavigate();
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <Select<Source>
          size="sm"
          className="px-2"
          value={sourceValue}
          onChange={(v) => navigate({ search: (s) => ({ ...s, source: v === "modrinth" ? undefined : v }), replace: true })}
          options={[
            { value: "modrinth", label: "Modrinth" },
            { value: "curseforge", label: "CurseForge", disabled: !cfAvailable },
            ...enabledStores.map((s) => ({
              value: `store:${s.id}` as Source,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {s.icon && <img src={s.icon} alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain" />}
                  {s.name}
                </span>
              ),
            })),
          ]}
        />
      </div>
      {!cfAvailable && !sysPending && apiKeys && (
        <Tooltip content={t("discover.cf_disabled")}>
          <Link
            to="/settings"
            search={{ tab: "downloads" }}
            aria-label={t("discover.cf_disabled")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.07] hover:text-text"
          >
            <Info size={15} />
          </Link>
        </Tooltip>
      )}
    </div>
  );
}
