// Eigenes Kontextmenü für Eingabefelder und markierten Text (Ausschneiden/Kopieren/Einfügen).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Clipboard, Copy, Scissors, TextSelect } from "lucide-react";
import { menuStyles, cn } from "@/components/ui";
import { useT } from "@/i18n";

interface TextMenuState {
  pos: { x: number; y: number } | null;
  target: HTMLElement | null;
  editable: boolean;
}
const useTextMenu = create<TextMenuState>(() => ({ pos: null, target: null, editable: false }));

export function openTextMenu(x: number, y: number, target: HTMLElement | null, editable: boolean) {
  useTextMenu.setState({ pos: { x, y }, target, editable });
}

async function writeClipboard(text: string) {
  try {
    const m = await import("@tauri-apps/plugin-clipboard-manager");
    await m.writeText(text);
  } catch {
    await navigator.clipboard?.writeText(text).catch(() => {});
  }
}
async function readClipboard(): Promise<string> {
  try {
    const m = await import("@tauri-apps/plugin-clipboard-manager");
    return (await m.readText()) ?? "";
  } catch {
    return (await navigator.clipboard?.readText().catch(() => "")) ?? "";
  }
}

function insertText(el: HTMLElement, text: string) {
  el.focus();
  // execCommand hält die Undo-Historie intakt und löst React-onChange aus
  if (!document.execCommand("insertText", false, text) && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? el.value.length;
    el.setRangeText(text, s, e, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function selectedText(target: HTMLElement | null): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0);
  }
  return window.getSelection()?.toString() ?? "";
}

export function TextMenuHost() {
  const { pos, target, editable } = useTextMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const t = useT();

  const close = () => useTextMenu.setState({ pos: null, target: null });

  useLayoutEffect(() => {
    if (!pos || !ref.current) return setPlace(null);
    const r = ref.current.getBoundingClientRect();
    setPlace({
      left: Math.min(pos.x, window.innerWidth - r.width - 8),
      top: Math.min(pos.y, window.innerHeight - r.height - 8),
    });
  }, [pos]);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  if (!pos) return null;
  const sel = selectedText(target);
  const readonly = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.readOnly : false;

  const items: { icon: React.ReactNode; label: string; disabled?: boolean; run: () => void | Promise<void> }[] = [];
  if (editable && !readonly)
    items.push({
      icon: <Scissors size={14} />,
      label: t("common.cut"),
      disabled: !sel,
      run: async () => {
        await writeClipboard(sel);
        if (target) insertText(target, "");
      },
    });
  items.push({ icon: <Copy size={14} />, label: t("common.copy"), disabled: !sel, run: () => writeClipboard(sel) });
  if (editable && !readonly)
    items.push({
      icon: <Clipboard size={14} />,
      label: t("common.paste"),
      run: async () => {
        const text = await readClipboard();
        if (target && text) insertText(target, text);
      },
    });
  if (editable)
    items.push({
      icon: <TextSelect size={14} />,
      label: t("common.select_all"),
      run: () => {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          target.focus();
          target.select();
        }
      },
    });

  return (
    <div
      ref={ref}
      role="menu"
      className={cn(menuStyles.panel, "fixed min-w-[180px]")}
      style={{ left: place?.left ?? pos.x, top: place?.top ?? pos.y, visibility: place ? "visible" : "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          disabled={it.disabled}
          className={cn(menuStyles.item, "w-full hover:bg-white/[.06] hover:shadow-[inset_2px_0_0_var(--accent)] disabled:pointer-events-none disabled:opacity-40")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => {
            close();
            await it.run();
          }}
        >
          <span className="grid w-4 place-items-center text-muted">{it.icon}</span>
          <span className="flex-1 text-left">{it.label}</span>
        </button>
      ))}
    </div>
  );
}
