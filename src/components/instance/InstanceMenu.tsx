// Aktionsmenü einer Instanz – derselbe Inhalt als Rechtsklick-Menü (Karten) und als Dropdown („Mehr“).
import type { ReactNode } from "react";
import {
  Box,
  Check,
  Copy,
  FolderOpen,
  FolderTree,
  ImageIcon,
  Palette,
  Play,
  Square,
  Tag as TagIcon,
  Trash2,
  Upload,
  Wrench,
  ExternalLink,
  RotateCcw,
  Plus,
  Link as LinkIcon,
  Monitor,
  LayoutList,
  Server as ServerIcon,
  Share2,
  SlidersHorizontal,
} from "lucide-react";
import { openNewServer } from "@/features/servers/actions";
import { openShare } from "@/features/social/dialogStore";
import { useVibe } from "@/lib/vibe";
import {
  ContextItem,
  ContextLabel,
  ContextSeparator,
  ContextSub,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownSub,
  type MenuItemProps,
} from "@/components/ui";
import { useInstances } from "@/lib/queries";
import { accentPalette, instanceAccent } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { useT } from "@/i18n";
import {
  FOLDERS,
  createShortcut,
  killInstance,
  openExport,
  openFolder,
  openGroupPrompt,
  openIconPicker,
  repairInstance,
  resetIcon,
  setAccent,
  setGroup,
  useInstanceActions,
} from "./actions";
import { useRunPhase } from "./status";
import { bedrockApi } from "@/features/bedrock/api";
import { toast } from "@/components/ui";

interface Kit {
  Item: (p: MenuItemProps) => ReactNode;
  Sub: (p: { icon?: ReactNode; label: ReactNode; children: ReactNode }) => ReactNode;
  Sep: () => ReactNode;
  Label: (p: { children: ReactNode }) => ReactNode;
}

const contextKit: Kit = { Item: ContextItem, Sub: ContextSub, Sep: ContextSeparator, Label: ContextLabel };
const dropdownKit: Kit = { Item: DropdownItem, Sub: DropdownSub, Sep: DropdownSeparator, Label: DropdownLabel };

function Swatch({ color, active }: { color: string; active?: boolean }) {
  return (
    <span className="grid h-3.5 w-3.5 place-items-center rounded-xs" style={{ background: color }}>
      {active && <Check size={10} strokeWidth={3} color="#000" />}
    </span>
  );
}

/**
 * `onPage`: Menü der Instanzseite. Dort gibt es den großen Spielen-Knopf und den Bereich „Einstellungen“, daher ohne
 * Spielen und statt der Untermenüs Icon/Akzentfarbe/Gruppe ein Eintrag „Bearbeiten …“ (`onEdit`).
 */
function MenuBody({ instance: i, kit, onPage, onDeleted, onEdit }: { instance: Instance; kit: Kit; onPage?: boolean; onDeleted?: () => void; onEdit?: () => void }) {
  const t = useT();
  const { Item, Sub, Sep, Label } = kit;
  const actions = useInstanceActions();
  const { phase } = useRunPhase(i.id);
  const { data: all = [] } = useInstances();
  const groups = [...new Set(all.map((x) => x.group).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b));
  const accent = instanceAccent(i.id, i.accent);
  const running = phase === "running" || phase === "preparing";
  const vibe = useVibe();
  // Bedrock: keine Java-Ordner, kein Export als Modpack, kein Teilen/Hosting/Reparieren
  const bedrock = !!i.bedrock;

  return (
    <>
      {onPage ? null : running ? (
        <Item icon={<Square size={13} />} onSelect={() => killInstance(i)}>
          {t("common.stop")}
        </Item>
      ) : (
        <Item icon={<Play size={14} />} disabled={phase === "busy"} onSelect={() => actions.launch(i)}>
          {t("common.play")}
        </Item>
      )}
      {!onPage && (
        <Item icon={<ExternalLink size={14} />} onSelect={() => actions.open(i)}>
          {t("inst.open")}
        </Item>
      )}
      {bedrock ? (
        <Item icon={<FolderOpen size={14} />} onSelect={() => bedrockApi.openFolder(i.id).catch((e) => toast.error(e))}>
          {t("common.open_folder")}
        </Item>
      ) : (
        <Sub icon={<FolderOpen size={14} />} label={t("common.open_folder")}>
          {FOLDERS.map((f) => (
            <Item key={f || "root"} icon={f ? <FolderTree size={14} /> : <FolderOpen size={14} />} onSelect={() => openFolder(i, f)}>
              {f ? <span>{f}</span> : t("inst.folder.game")}
            </Item>
          ))}
        </Sub>
      )}
      <Sep />
      <Item icon={<Copy size={14} />} disabled={bedrock && running} onSelect={() => actions.duplicate(i)}>
        {t("inst.duplicate")}
      </Item>
      {!bedrock && (
        <Item icon={<Upload size={14} />} onSelect={() => openExport(i)}>
          {t("inst.export")}
        </Item>
      )}
      {vibe.sharing && !bedrock && (
        <Item icon={<Share2 size={14} />} onSelect={() => openShare(i.id)}>
          {t("social.share.menu")}
        </Item>
      )}
      <Sub icon={<LinkIcon size={14} />} label={t("inst.shortcut")}>
        <Item icon={<Monitor size={14} />} onSelect={() => createShortcut(i, "desktop")}>
          {t("inst.shortcut.desktop")}
        </Item>
        <Item icon={<LayoutList size={14} />} onSelect={() => createShortcut(i, "start_menu")}>
          {t("inst.shortcut.start_menu")}
        </Item>
      </Sub>
      {!bedrock && (
        <Item icon={<ServerIcon size={14} />} onSelect={() => openNewServer(i.id)}>
          {t("srv.host_instance")}
        </Item>
      )}
      <Sep />
      {onEdit ? (
        <Item icon={<SlidersHorizontal size={14} />} onSelect={onEdit}>
          {t("ipage.menu.edit")}
        </Item>
      ) : (
        <>
          <Sub icon={<ImageIcon size={14} />} label={t("inst.icon")}>
            <Item icon={<ImageIcon size={14} />} onSelect={() => openIconPicker(i)}>
              {t("inst.icon.choose")}
            </Item>
            <Item icon={<RotateCcw size={14} />} disabled={!i.icon} onSelect={() => resetIcon(i)}>
              {t("inst.icon.reset")}
            </Item>
          </Sub>
          <Sub icon={<Palette size={14} />} label={t("inst.accent")}>
            <Label>{t("inst.accent")}</Label>
            {accentPalette.map((c) => (
              <Item key={c} icon={<Swatch color={c} active={c === accent} />} onSelect={() => setAccent(i, c)}>
                <span className="tabular-nums text-muted">{c}</span>
              </Item>
            ))}
            <Sep />
            <Item icon={<RotateCcw size={14} />} disabled={!i.accent} onSelect={() => setAccent(i, null)}>
              {t("inst.accent.auto")}
            </Item>
          </Sub>
          <Sub icon={<TagIcon size={14} />} label={t("inst.group")}>
            {groups.map((g) => (
              <Item key={g} icon={g === i.group ? <Check size={14} className="text-accent" /> : <Box size={14} />} onSelect={() => setGroup(i, g)}>
                {g}
              </Item>
            ))}
            {groups.length > 0 && <Sep />}
            <Item icon={<Plus size={14} />} onSelect={() => openGroupPrompt(i)}>
              {t("inst.group.new")}
            </Item>
            <Item icon={<RotateCcw size={14} />} disabled={!i.group} onSelect={() => setGroup(i, null)}>
              {t("inst.group.none")}
            </Item>
          </Sub>
        </>
      )}
      <Sep />
      {!bedrock && (
        <Item icon={<Wrench size={14} />} disabled={running || phase === "busy"} onSelect={() => repairInstance(i)}>
          {t("inst.repair")}
        </Item>
      )}
      <Item icon={<Trash2 size={14} />} danger disabled={running} onSelect={() => actions.remove(i, onDeleted)}>
        {t("common.delete")}
      </Item>
    </>
  );
}

export function InstanceContextMenuContent({ instance }: { instance: Instance }) {
  return <MenuBody instance={instance} kit={contextKit} />;
}

export function InstanceDropdownContent({ instance, onDeleted, onEdit }: { instance: Instance; onDeleted?: () => void; onEdit?: () => void }) {
  return <MenuBody instance={instance} kit={dropdownKit} onPage onDeleted={onDeleted} onEdit={onEdit} />;
}
