// Kontextmenü (Rechtsklick) und Dropdown im Launcher-Look. Beide teilen sich dieselben Styles.
import * as CM from "@radix-ui/react-context-menu";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

const panel =
  "z-[60] min-w-[200px] rounded-card bg-overlay p-1 shadow-e2 " +
  "data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)] outline-none";
const item =
  "relative flex h-8 cursor-pointer select-none items-center gap-2.5 rounded-ctl px-2.5 text-[13px] text-text outline-none " +
  "data-[highlighted]:bg-white/[.07] " +
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-40";
const dangerItem = "text-danger data-[highlighted]:bg-danger/12";
const sep = "-mx-1 my-1 h-px bg-line";
const labelCls = "px-2.5 pb-1 pt-2 text-[11px] font-semibold text-dim";

export interface MenuItemProps {
  icon?: ReactNode;
  children: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

function ItemInner({ icon, children, shortcut }: { icon?: ReactNode; children: ReactNode; shortcut?: string }) {
  return (
    <>
      <span className="grid w-4 place-items-center text-muted">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="font-mono text-[10px] text-dim">{shortcut}</span>}
    </>
  );
}

// ------------------------------------------------------------------ Kontextmenü

export function ContextMenu({ children, content, disabled }: { children: ReactNode; content: ReactNode; disabled?: boolean }) {
  return (
    <CM.Root modal={false}>
      <CM.Trigger asChild disabled={disabled}>
        {children}
      </CM.Trigger>
      <CM.Portal>
        <CM.Content className={panel} collisionPadding={8}>
          {content}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

export function ContextItem({ icon, children, shortcut, danger, disabled, onSelect }: MenuItemProps) {
  return (
    <CM.Item className={cn(item, danger && dangerItem)} disabled={disabled} onSelect={onSelect}>
      <ItemInner icon={icon} shortcut={shortcut}>
        {children}
      </ItemInner>
    </CM.Item>
  );
}

export function ContextCheckItem({ checked, children, onCheckedChange }: { checked: boolean; children: ReactNode; onCheckedChange: (v: boolean) => void }) {
  return (
    <CM.CheckboxItem className={item} checked={checked} onCheckedChange={onCheckedChange}>
      <ItemInner icon={checked ? <Check size={14} /> : null}>{children}</ItemInner>
    </CM.CheckboxItem>
  );
}

export function ContextSeparator() {
  return <CM.Separator className={sep} />;
}

export function ContextLabel({ children }: { children: ReactNode }) {
  return <CM.Label className={labelCls}>{children}</CM.Label>;
}

export function ContextSub({ icon, label, children }: { icon?: ReactNode; label: ReactNode; children: ReactNode }) {
  return (
    <CM.Sub>
      <CM.SubTrigger className={item}>
        <ItemInner icon={icon}>{label}</ItemInner>
        <ChevronRight size={14} className="text-dim" />
      </CM.SubTrigger>
      <CM.Portal>
        <CM.SubContent className={panel} sideOffset={4} collisionPadding={8}>
          {children}
        </CM.SubContent>
      </CM.Portal>
    </CM.Sub>
  );
}

// ------------------------------------------------------------------ Dropdown

export function DropdownMenu({
  trigger,
  children,
  align = "end",
  side = "bottom",
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content className={panel} align={align} side={side} sideOffset={6} collisionPadding={8}>
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function DropdownItem({ icon, children, shortcut, danger, disabled, onSelect }: MenuItemProps) {
  return (
    <DM.Item className={cn(item, danger && dangerItem)} disabled={disabled} onSelect={onSelect}>
      <ItemInner icon={icon} shortcut={shortcut}>
        {children}
      </ItemInner>
    </DM.Item>
  );
}

export function DropdownCheckItem({ checked, children, onCheckedChange }: { checked: boolean; children: ReactNode; onCheckedChange: (v: boolean) => void }) {
  return (
    <DM.CheckboxItem className={item} checked={checked} onCheckedChange={onCheckedChange} onSelect={(e) => e.preventDefault()}>
      <ItemInner icon={checked ? <Check size={14} /> : null}>{children}</ItemInner>
    </DM.CheckboxItem>
  );
}

export function DropdownSeparator() {
  return <DM.Separator className={sep} />;
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <DM.Label className={labelCls}>{children}</DM.Label>;
}

/** Untermenü im Dropdown (gleiche API wie `ContextSub`). */
export function DropdownSub({ icon, label, children }: { icon?: ReactNode; label: ReactNode; children: ReactNode }) {
  return (
    <DM.Sub>
      <DM.SubTrigger className={item}>
        <ItemInner icon={icon}>{label}</ItemInner>
        <ChevronRight size={14} className="text-dim" />
      </DM.SubTrigger>
      <DM.Portal>
        <DM.SubContent className={panel} sideOffset={4} collisionPadding={8}>
          {children}
        </DM.SubContent>
      </DM.Portal>
    </DM.Sub>
  );
}

/** Styles für eigene Menüs (z. B. Text-Kontextmenü). */
export const menuStyles = { panel, item, sep, label: labelCls };
