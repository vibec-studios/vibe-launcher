import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Dialog, SearchInput, Section, Skeleton } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { useT } from "@/i18n";
import { instanceAccent, loaderNames } from "@/lib/format";
import { useJavaInstances } from "@/lib/queries";
import { openShare } from "../dialogStore";
import { MyPacks } from "./MyPacks";
import { closePageDialog as close } from "./store";

export function SharePackDialog() {
  const t = useT();
  const { data: instances = [], isLoading } = useJavaInstances();
  const [q, setQ] = useState("");
  const list = instances.filter((i) => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title={t("social.action.share")} description={t("social.share.pick_desc")} size="md">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          {instances.length > 6 && (
            <SearchInput value={q} onChange={setQ} placeholder={t("social.share.pick_search")} aria-label={t("social.share.pick_search")} />
          )}
          <div className="scroll max-h-[280px] rounded-card bg-surface">
            {isLoading ? (
              <div className="flex flex-col gap-1 p-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : !list.length ? (
              <p className="px-4 py-6 text-center text-[12.5px] text-dim">{instances.length ? t("social.add.none") : t("social.share.no_instances")}</p>
            ) : (
              list.map((i) => (
                <button
                  key={i.id}
                  onClick={() => {
                    close();
                    openShare(i.id);
                  }}
                  className="group flex h-12 w-full items-center gap-3 border-line px-3 text-left transition-colors duration-100 hover:bg-white/[.04] [&+&]:border-t"
                >
                  <InstanceIcon icon={i.icon} seed={i.id} accent={instanceAccent(i.id, i.accent)} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold leading-tight text-text">{i.name}</span>
                    <span className="block truncate text-caption text-dim">
                      {i.mc_version} · {loaderNames[i.loader.kind]}
                    </span>
                  </span>
                  <ChevronRight size={15} className="text-dim transition-colors duration-100 group-hover:text-text" />
                </button>
              ))
            )}
          </div>
        </div>
        <Section title={t("social.pack.title")}>
          <MyPacks />
        </Section>
      </div>
    </Dialog>
  );
}
