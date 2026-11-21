import { ClipboardCopy, Copy, ExternalLink, FilePlus, FolderInput, FolderPlus, Pencil, Trash2, FileText } from "lucide-react";
import { ContextItem, ContextSeparator } from "@/components/ui";
import { useT } from "@/i18n";
import type { FileEntry } from "@/lib/types";
import { targetDir, type FileActions } from "./rows";

export function EntryMenu({ entry, actions }: { entry: FileEntry; actions: FileActions }) {
  const t = useT();
  const dir = targetDir(entry);
  return (
    <>
      {!entry.is_dir && (
        <ContextItem icon={<FileText size={14} />} shortcut="Enter" onSelect={() => actions.open(entry)}>
          {t("files.act.open")}
        </ContextItem>
      )}
      <ContextItem icon={<FilePlus size={14} />} shortcut="Strg+N" onSelect={() => actions.newItem("file", dir)}>
        {t("files.act.new_file")}
      </ContextItem>
      <ContextItem icon={<FolderPlus size={14} />} shortcut="Strg+⇧+N" onSelect={() => actions.newItem("folder", dir)}>
        {t("files.act.new_folder")}
      </ContextItem>
      <ContextItem icon={<FolderInput size={14} />} onSelect={() => actions.importInto(dir, false)}>
        {t("files.act.import_files")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<Pencil size={14} />} shortcut="F2" onSelect={() => actions.rename(entry)}>
        {t("files.act.rename")}
      </ContextItem>
      <ContextItem icon={<Copy size={14} />} shortcut="Strg+D" onSelect={() => actions.duplicate(entry)}>
        {t("files.act.duplicate")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<ClipboardCopy size={14} />} shortcut="Strg+⇧+C" onSelect={() => actions.copyPath(entry.path, false)}>
        {t("files.act.copy_path")}
      </ContextItem>
      <ContextItem icon={<ClipboardCopy size={14} />} onSelect={() => actions.copyPath(entry.path, true)}>
        {t("files.act.copy_rel")}
      </ContextItem>
      <ContextItem icon={<ExternalLink size={14} />} onSelect={() => actions.reveal(entry.path)}>
        {t("files.act.reveal")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<Trash2 size={14} />} shortcut="Entf" danger onSelect={() => actions.remove(entry)}>
        {t("files.act.delete")}
      </ContextItem>
    </>
  );
}

export function RootMenu({ actions }: { actions: FileActions }) {
  const t = useT();
  return (
    <>
      <ContextItem icon={<FilePlus size={14} />} onSelect={() => actions.newItem("file", "")}>
        {t("files.act.new_file")}
      </ContextItem>
      <ContextItem icon={<FolderPlus size={14} />} onSelect={() => actions.newItem("folder", "")}>
        {t("files.act.new_folder")}
      </ContextItem>
      <ContextItem icon={<FolderInput size={14} />} onSelect={() => actions.importInto("", false)}>
        {t("files.act.import_files")}
      </ContextItem>
      <ContextItem icon={<FolderInput size={14} />} onSelect={() => actions.importInto("", true)}>
        {t("files.act.import_folder")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<ClipboardCopy size={14} />} onSelect={() => actions.copyPath("", false)}>
        {t("files.act.copy_path")}
      </ContextItem>
      <ContextItem icon={<ExternalLink size={14} />} onSelect={() => actions.reveal("")}>
        {t("files.act.reveal")}
      </ContextItem>
    </>
  );
}
