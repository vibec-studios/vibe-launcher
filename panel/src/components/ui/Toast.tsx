import { useSyncExternalStore } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { cn } from "./cn";

interface ToastItem {
  id: number;
  text: string;
  tone: "ok" | "error";
}

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function push(text: string, tone: ToastItem["tone"]) {
  const id = ++seq;
  items = [...items.slice(-3), { id, text, tone }];
  notify();
  setTimeout(() => dismiss(id), tone === "error" ? 7000 : 3500);
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id);
  notify();
}

export const toast = {
  ok: (text: string) => push(text, "ok"),
  error: (e: unknown) => push(e instanceof Error ? e.message : String(e), "error"),
};

export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
  );
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 left-4 z-[60] flex flex-col items-end gap-2 sm:left-auto">
      {list.map((i) => (
        <div key={i.id} role="status" className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-card bg-overlay px-4 py-3 text-[13.5px] shadow-e3 animate-pop-in">
          {i.tone === "ok" ? <CheckCircle2 size={17} className="mt-px shrink-0 text-ok" /> : <AlertTriangle size={17} className="mt-px shrink-0 text-danger" />}
          <span className={cn("min-w-0 flex-1", i.tone === "error" && "text-text")}>{i.text}</span>
          <button className="text-dim hover:text-text" onClick={() => dismiss(i.id)} aria-label="×">
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
