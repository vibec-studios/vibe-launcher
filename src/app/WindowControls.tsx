// Fensterknöpfe (Minimieren, Maximieren, Schließen) für die eigene Titelleiste – auch im Onboarding.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";

export function WindowControls() {
  const t = useT();
  const [max, setMax] = useState(false);
  useEffect(() => {
    const w = getCurrentWindow();
    w.isMaximized().then(setMax).catch(() => {});
    const un = w.onResized(() => w.isMaximized().then(setMax).catch(() => {}));
    return () => {
      un.then((f) => f());
    };
  }, []);
  const btn = "grid h-full w-[46px] place-items-center text-muted transition-colors duration-100 hover:bg-white/[.07] hover:text-text";
  return (
    <div className="flex h-full">
      <button aria-label={t("window.minimize")} className={btn} onClick={() => getCurrentWindow().minimize()}>
        <Minus size={16} strokeWidth={1.5} />
      </button>
      <button aria-label={t("window.maximize")} className={btn} onClick={() => getCurrentWindow().toggleMaximize()}>
        {max ? <Copy size={13} strokeWidth={1.5} className="-scale-x-100" /> : <Square size={13} strokeWidth={1.5} />}
      </button>
      <button aria-label={t("window.close")} className={cn(btn, "hover:bg-[#e81123] hover:text-[#fff]")} onClick={() => getCurrentWindow().close()}>
        <X size={17} strokeWidth={1.5} />
      </button>
    </div>
  );
}
