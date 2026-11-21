import { FilePlus2, FolderOpen, Grid3x3, Library, MoreHorizontal, Redo2, Trash2, Undo2, UserRound } from "lucide-react";
import { DropdownItem, DropdownMenu, DropdownSeparator, IconButton, Segmented, Button } from "@/components/ui";
import { useT } from "@/i18n";
import { Term } from "@/features/help/glossary/Term";
import type { SkinEditor } from "./useSkinEditor";

export interface OpenActions {
  template: () => void;
  current?: { name: string; open: () => void };
  library: () => void;
}

export function EditorToolbar({ ed, open }: { ed: SkinEditor; open: OpenActions }) {
  const t = useT();
  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 px-3 py-2">
      <DropdownMenu
        align="start"
        trigger={
          <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />}>
            {t("skined.start")}
          </Button>
        }
      >
        <DropdownItem icon={<FilePlus2 size={14} />} onSelect={open.template}>
          {t("skined.start_template")}
        </DropdownItem>
        {open.current && (
          <DropdownItem icon={<UserRound size={14} />} onSelect={open.current.open}>
            {t("skined.start_current", { name: open.current.name })}
          </DropdownItem>
        )}
        <DropdownItem icon={<Library size={14} />} onSelect={open.library}>
          {t("skined.start_library")}
        </DropdownItem>
      </DropdownMenu>
      <div className="mx-1 h-5 w-px bg-line" />
      <span className="text-meta text-muted">
        <Term id="skinlayer">{t("skined.layer")}</Term>
      </span>
      <Segmented
        value={ed.layer}
        onChange={ed.setLayer}
        items={[
          { value: "base", label: t("skined.layer.base") },
          { value: "overlay", label: t("skined.layer.overlay") },
        ]}
      />
      <div className="flex-1" />
      <IconButton label={t("skined.undo")} tip variant="ghost" size="sm" disabled={!ed.canUndo} onClick={ed.undo}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton label={t("skined.redo")} tip variant="ghost" size="sm" disabled={!ed.canRedo} onClick={ed.redo}>
        <Redo2 size={16} />
      </IconButton>
      <IconButton label={t("skined.grid")} tip variant="ghost" size="sm" active={ed.grid} onClick={() => ed.setGrid(!ed.grid)}>
        <Grid3x3 size={16} />
      </IconButton>
      <DropdownMenu
        trigger={
          <IconButton label={t("skined.more")} tip variant="ghost" size="sm">
            <MoreHorizontal size={16} />
          </IconButton>
        }
      >
        <DropdownItem onSelect={() => ed.mirrorSides("right")}>{t("skined.copy_right")}</DropdownItem>
        <DropdownItem onSelect={() => ed.mirrorSides("left")}>{t("skined.copy_left")}</DropdownItem>
        <DropdownSeparator />
        <DropdownItem icon={<Trash2 size={14} />} danger onSelect={ed.clearCurrentLayer}>
          {ed.layer === "overlay" ? t("skined.clear_layer") : t("skined.clear_base")}
          {ed.focus !== "all" ? ` · ${t(`skined.part.${ed.focus}`)}` : ""}
        </DropdownItem>
      </DropdownMenu>
    </div>
  );
}
