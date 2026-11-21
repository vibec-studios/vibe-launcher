import { Fragment, type ReactNode } from "react";
import { ContextItem, ContextSeparator, DropdownItem, DropdownSeparator } from "@/components/ui";

export interface MsgAction {
  key: string;
  icon: ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  sep?: boolean;
  onSelect: () => void;
}

/** Gleiche Einträge für Rechtsklick und das ⋯ neben der Blase. */
export function MsgItems({ actions, kind }: { actions: MsgAction[]; kind: "context" | "dropdown" }) {
  const Item = kind === "context" ? ContextItem : DropdownItem;
  const Sep = kind === "context" ? ContextSeparator : DropdownSeparator;
  return (
    <>
      {actions.map((a) => (
        <Fragment key={a.key}>
          {a.sep && <Sep />}
          <Item icon={a.icon} danger={a.danger} disabled={a.disabled} onSelect={a.onSelect}>
            {a.label}
          </Item>
        </Fragment>
      ))}
    </>
  );
}
