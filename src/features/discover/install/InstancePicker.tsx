import * as Popover from "@radix-ui/react-popover";
import { useQueries } from "@tanstack/react-query";
import { ChevronDown, Download, ExternalLink, ListFilter, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { qk, useJavaInstances } from "@/lib/queries";
import { ManualBadge } from "@/components/content/ManualBadge";
import { openInstall } from "@/components/content/installStore";
import { compatibility, contentKindOf, navigateTo } from "@/components/content/util";
import { ServerPickerSection } from "../server/ServerPickerSection";
import { PickerRow } from "./PickerRow";
import { stop, type P } from "./shared";

export function InstancePicker({ project, size, wide }: { project: P; size: "sm" | "md"; wide?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const manual = !!project.manual_download;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          size={size}
          variant={wide ? "primary" : "ghost"}
          icon={manual ? <ExternalLink size={size === "md" ? 15 : 13} /> : <Download size={size === "md" ? 15 : 13} />}
          onClick={stop}
          className={cn("pr-2", open && !wide && "bg-surface3")}
          aria-haspopup="dialog"
        >
          {manual ? (wide ? t("manual.download") : t("manual.download_short")) : t("common.install")}
          <ChevronDown size={13} className={cn("ml-0.5 opacity-70 transition-transform duration-150", open && "rotate-180")} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onClick={stop}
          className="z-[60] flex max-h-[var(--radix-popover-content-available-height)] w-[300px] flex-col rounded-card bg-overlay p-1 shadow-e2 outline-none data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          {open && <PickerList project={project} close={() => setOpen(false)} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function PickerList({ project, close }: { project: P; close: () => void }) {
  const t = useT();
  const { data: instances, isPending } = useJavaInstances();
  const kind = contentKindOf(project.project_type);
  const list = useMemo(
    () =>
      (instances ?? [])
        .map((i) => ({ i, c: compatibility(project, i) }))
        .sort((a, b) => Number(b.c.ok) - Number(a.c.ok) || (b.i.last_played ?? 0) - (a.i.last_played ?? 0)),
    [instances, project],
  );
  // Installiert-Status je Instanz (gleicher Cache wie der Inhalte-Tab)
  const lists = useQueries({
    queries: list.map(({ i }) => ({
      queryKey: qk.content(i.id, kind ?? "mod"),
      queryFn: () => api.contentList(i.id, kind!),
      enabled: !!kind,
      staleTime: 30_000,
    })),
  });
  const installedIn = (idx: number) => !!lists[idx]?.data?.some((c) => c.project_id === project.id);

  return (
    <div className="flex min-h-0 flex-col">
      {project.manual_download && (
        <div className="mx-1 mb-1 mt-1 flex gap-2 rounded-ctl bg-warn/[.08] px-2.5 py-2 text-[12px] leading-snug text-muted">
          <ManualBadge iconOnly className="mt-px" />
          <span>{t("manual.picker_note")}</span>
        </div>
      )}
      <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold text-dim">{project.manual_download ? t("manual.download_for") : t("discover.install_in")}</div>
      {isPending ? (
        <div className="grid h-16 place-items-center">
          <Spinner size={14} />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-2.5 py-2">
          <p className="text-[12.5px] text-muted">{t("install.no_instances_text")}</p>
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={13} />}
            onClick={() => {
              close();
              navigateTo({ to: "/instances" });
            }}
          >
            {t("install.create_instance")}
          </Button>
        </div>
      ) : (
        <div className="scroll max-h-[min(300px,35vh)] min-h-[48px] shrink">
          {list.map(({ i, c }, idx) => (
            <PickerRow key={i.id} inst={i} project={project} ok={c.ok} reason={c.ok ? null : c.reason} installed={installedIn(idx)} checking={!!kind && lists[idx]?.isPending} close={close} />
          ))}
        </div>
      )}
      <ServerPickerSection project={project} close={close} />
      <div className="-mx-1 my-1 h-px bg-line" />
      <button
        onClick={() => {
          close();
          openInstall({ project });
        }}
        className="flex h-8 shrink-0 items-center gap-2.5 rounded-ctl px-2.5 text-left text-[13px] text-muted outline-none transition-colors hover:bg-white/[.07] hover:text-text"
      >
        <ListFilter size={14} />
        {t("discover.install_choose")}
      </button>
    </div>
  );
}
