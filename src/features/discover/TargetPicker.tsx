import { getRouteApi, Link } from "@tanstack/react-router";
import { Gamepad2, Server as ServerLucide } from "lucide-react";
import { Segmented, Select } from "@/components/ui";
import { useT } from "@/i18n";
import { useJavaInstances } from "@/lib/queries";
import { useSimple } from "@/lib/mode";
import { useServerTargets } from "@/features/installtarget/hooks";
import { addonSupport } from "@/features/installtarget/registry";
import { softwareLabel } from "./server/parts";

const route = getRouteApi("/discover");
const NONE = "__none";

export function TargetPicker() {
  const t = useT();
  const simple = useSimple();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const instances = useJavaInstances();
  const { targets } = useServerTargets();
  const servers = targets.filter((s) => addonSupport(s));
  const mode = search.server ? "server" : "instance";
  if (simple && !search.server) return null;

  const toServer = (key: string | undefined) =>
    navigate({ search: (s) => ({ q: s.q, server: key ?? servers[0]?.key ?? "none" }), replace: true });
  const toInstance = (id: string | undefined) => navigate({ search: (s) => ({ q: s.q, instance: id }), replace: true });

  return (
    <div className="flex flex-col gap-2" data-testid="discover-target">
      <Segmented<"instance" | "server">
        size="sm"
        className="w-full [&>button]:flex-1"
        value={mode}
        onChange={(v) => (v === "server" ? toServer(undefined) : toInstance(undefined))}
        items={[
          { value: "instance", label: <span className="inline-flex items-center gap-1.5"><Gamepad2 size={13} />{t("st.target.instance")}</span> },
          { value: "server", label: <span className="inline-flex items-center gap-1.5"><ServerLucide size={13} />{t("st.target.server")}</span> },
        ]}
      />
      {mode === "instance" ? (
        !simple && (
          <Select
            size="sm"
            className="px-2"
            value={search.instance ?? NONE}
            onChange={(v) => toInstance(v === NONE ? undefined : v)}
            options={[{ value: NONE, label: t("st.target.choose_later") }, ...(instances.data ?? []).map((i) => ({ value: i.id, label: i.name }))]}
          />
        )
      ) : servers.length === 0 ? (
        <div className="px-2 text-[12px] leading-snug text-dim">
          {t("st.target.no_servers")}{" "}
          <Link to="/servers" className="font-semibold text-muted hover:text-text">
            {t("st.target.to_servers")}
          </Link>
        </div>
      ) : (
        <Select
          size="sm"
          className="px-2"
          value={servers.some((s) => s.key === search.server) ? search.server! : NONE}
          onChange={(v) => v !== NONE && toServer(v)}
          options={[
            ...(servers.some((s) => s.key === search.server) ? [] : [{ value: NONE, label: t("st.target.pick_server") }]),
            ...servers.map((s) => ({
              value: s.key,
              label: `${s.name} · ${softwareLabel(s)} ${s.mc_version}${s.origin === "remote" ? ` · ${s.agentName ?? t("st.remote")}` : ""}`,
            })),
          ]}
        />
      )}
    </div>
  );
}
