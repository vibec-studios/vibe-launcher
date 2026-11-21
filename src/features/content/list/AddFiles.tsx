import { ChevronDown, FilePlus2, Plus } from "lucide-react";
import { Button, DropdownItem, DropdownMenu, SearchInput, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { ContentKind } from "@/lib/types";
import { kindExtensions } from "@/components/content/util";
import { addContentFiles } from "../addContentFiles";

export async function addFiles(id: string, kind: ContentKind, t: ReturnType<typeof useT>) {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({
      multiple: true,
      title: t(`content.add_files.${kind}`),
      filters: [{ name: t(`content.kind.${kind}`), extensions: kindExtensions[kind] }],
    });
    const paths = Array.isArray(res) ? res : res ? [res] : [];
    await addContentFiles(id, kind, paths);
  } catch (e) {
    toast.error(e);
  }
}

export function AddFilesItems({ id, kinds }: { id: string; kinds: ContentKind[] }) {
  const t = useT();
  return (
    <>
      {kinds.map((k) => (
        <DropdownItem key={k} icon={<FilePlus2 size={14} />} onSelect={() => void addFiles(id, k, t)}>
          {t(`content.add_files.${k}`)} …
        </DropdownItem>
      ))}
    </>
  );
}

interface SearchRowProps {
  id: string;
  kinds: ContentKind[];
  text: string;
  setText: (v: string) => void;
  total: number;
  toDiscover: () => void;
}

export function ContentSearchRow({ id, kinds, text, setText, total, toDiscover }: SearchRowProps) {
  const t = useT();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <SearchInput
        value={text}
        onChange={setText}
        placeholder={t("ipage.ct.search", { n: total })}
        className="min-w-[160px] flex-1"
      />
      <DropdownMenu
        trigger={
          <Button variant="ghost" data-tour="content-add-files" icon={<FilePlus2 size={15} />} className="data-[state=open]:bg-surface3">
            <span className="hidden @min-[760px]:inline">{t("content.add_files_short")}</span>
            <ChevronDown size={14} className="text-dim" />
          </Button>
        }
      >
        <AddFilesItems id={id} kinds={kinds} />
      </DropdownMenu>
      <Button variant="accent" data-tour="content-add" icon={<Plus size={16} />} onClick={toDiscover}>
        {t("content.add")}
      </Button>
    </div>
  );
}
