import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Button, EmptyState, PageToolbar, SearchInput, Skeleton, Tag, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import type { Source } from "@/lib/types";
import { useServerTarget } from "@/features/installtarget/hooks";
import { addonSupport } from "@/features/installtarget/registry";
import type { ServerTargetInfo } from "@/features/installtarget/types";
import type { AddonHit, AddonSource } from "@/features/servers/addonsApi";
import { CheckRow, FilterGroup } from "../components/FilterGroup";
import { route } from "../constants";
import { useProjectOverlayNav } from "../ProjectOverlay";
import { TargetPicker } from "../TargetPicker";
import { softwareLabel } from "./parts";
import { ServerResults } from "./ServerResults";
import { ServerSheet } from "./ServerSheet";
import { ServerTargetBanner } from "./ServerTargetBanner";
import { SORTS, useServerDiscover } from "./store";

export function hangarSupported(t: ServerTargetInfo | null) {
  return !!t?.platform && t.platform.kind !== "folia";
}

export function ServerDiscover({ serverKey }: { serverKey: string }) {
  const t = useT();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const { target, pending, missing } = useServerTarget(serverKey);
  const kind = target ? addonSupport(target) : null;
  const store = useServerDiscover();
  const hangar = hangarSupported(target);
  const source: AddonSource = hangar ? store.source : "modrinth";

  const [text, setText] = useState(search.q ?? "");
  useEffect(() => setText(search.q ?? ""), [search.q]);
  useEffect(() => {
    if ((search.q ?? "") === text) return;
    const h = setTimeout(() => navigate({ search: (s) => ({ ...s, q: text || undefined }), replace: true }), 250);
    return () => clearTimeout(h);
  }, [text, search.q, navigate]);
  const q = (search.q ?? "").trim();

  const overlay = useProjectOverlayNav();
  const openHit = (h: Pick<AddonHit, "source" | "id">) => overlay.open(h.source as Source, h.id);

  return (
    <div className="relative flex h-full flex-col">
      {search.p && target && <ServerSheet target={target} value={search.p} />}
      <ServerTargetBanner target={target} pending={pending} />
      <div className="flex min-h-0 flex-1">
        <aside className="scroll flex w-[220px] shrink-0 flex-col px-3 pb-6 pt-4">
          <div className="mb-1 flex h-9 shrink-0 items-center gap-2 pl-2">
            <span className="flex-1 text-section text-text">{t("discover.filters")}</span>
          </div>
          <FilterGroup id="target" title={t("st.target.title")}>
            <TargetPicker />
          </FilterGroup>
          {target && kind && (
            <>
              <FilterGroup id="server-source" title={t("discover.source")}>
                <div className="flex flex-col gap-px" role="radiogroup" aria-label={t("discover.source")}>
                  <CheckRow radio on={source === "modrinth"} label="Modrinth" onClick={() => store.set({ source: "modrinth" })} />
                  {hangar ? (
                    <CheckRow radio on={source === "hangar"} label="Hangar" onClick={() => store.set({ source: "hangar" })} />
                  ) : (
                    <Tooltip content={t(kind === "plugins" ? "st.hangar.folia" : "st.hangar.mods")}>
                      <span className="flex h-7 items-center px-2 text-[13px] text-dim opacity-60">Hangar</span>
                    </Tooltip>
                  )}
                </div>
              </FilterGroup>
              <FilterGroup id="server-fit" title={t("st.fit.title")}>
                <div className="flex flex-col gap-1 px-2 text-[12.5px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <Check size={13} className="text-ok" />
                    Minecraft {target.mc_version}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Check size={13} className="text-ok" />
                    {softwareLabel(target)}
                  </span>
                  {kind === "mods" && (
                    <span className="flex items-center gap-1.5">
                      <Check size={13} className="text-ok" />
                      {t("st.fit.server_side")}
                    </span>
                  )}
                  <span className="mt-1 text-[11.5px] leading-snug text-dim">{t("st.fit.hint")}</span>
                </div>
              </FilterGroup>
              <FilterGroup id="server-sort" title={t("discover.sort")}>
                <div className="flex flex-col gap-px" role="radiogroup" aria-label={t("discover.sort")}>
                  {SORTS.map((s) => (
                    <CheckRow key={s} radio on={store.sort === s} label={t(`srv.addons.sort.${s}`)} onClick={() => store.set({ sort: s })} />
                  ))}
                </div>
              </FilterGroup>
            </>
          )}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 px-6 pt-4">
            <PageToolbar>
              <Tag color="var(--color-accent)">{kind === "plugins" ? t("st.kind.plugins") : t("st.kind.mods")}</Tag>
              <SearchInput
                value={text}
                onChange={setText}
                placeholder={kind === "plugins" ? t("srv.addons.search.plugins") : t("srv.addons.search.mods")}
                className="min-w-[180px] flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape" && text) setText("");
                }}
              />
            </PageToolbar>
          </div>
          {missing ? (
            <EmptyState
              icon="server_off"
              title={t("st.missing.title")}
              text={t("st.missing.text")}
              action={
                <Button variant="ghost" onClick={() => navigate({ search: (s) => ({ q: s.q }), replace: true })}>
                  {t("st.missing.back")}
                </Button>
              }
            />
          ) : !target ? (
            <div className="flex flex-col gap-2 px-6 pt-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : !kind ? (
            <EmptyState
              icon="puzzle"
              title={t("st.vanilla.title")}
              text={t("st.vanilla.text")}
              action={
                target.origin === "local" ? (
                  <Link to="/servers/$id" params={{ id: target.id }} search={{ tab: "settings" }} className="inline-flex h-8 items-center rounded-ctl bg-surface2 px-3 text-[13px] font-semibold text-text hover:bg-surface3">
                    {t("st.vanilla.cta")}
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <ServerResults key={`${target.key}|${source}|${q}|${store.sort}`} target={target} source={source} query={q} sort={store.sort} onOpen={openHit} />
          )}
        </div>
      </div>
    </div>
  );
}
