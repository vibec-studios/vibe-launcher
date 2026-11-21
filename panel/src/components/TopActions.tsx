import { useEffect, useRef, useState } from "react";
import { LogOut, Moon, Sun, UserCircle2 } from "lucide-react";
import { setLang, useLang, useT } from "@/i18n";
import { setTone, useTone } from "@/app/theme";
import { IS_MOCK } from "@/app/runtime";
import { IconButton } from "./ui";

export function Brand() {
  return (
    <a href="#/" className="flex items-center gap-2.5">
      <img src="./logo.png" alt="" className="size-8" />
      <span className="brand text-[15px] leading-none">
        Vibe <span className="text-accent">Panel</span>
      </span>
      {IS_MOCK && <span className="rounded-xs bg-warn/15 px-1.5 py-0.5 text-[10px] font-bold text-warn">DEMO</span>}
    </a>
  );
}

export function TopActions({ onLogout, account }: { onLogout?: () => void; account?: string }) {
  const t = useT();
  const tone = useTone();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setLang(lang === "de" ? "en" : "de")}
        className="h-9 rounded-ctl px-2.5 text-[12.5px] font-bold text-muted hover:bg-white/[.07] hover:text-text"
        title={t("top.language")}
        aria-label={t("top.language")}
      >
        {lang === "de" ? "DE" : "EN"}
      </button>
      <IconButton label={tone === "dark" ? t("top.light") : t("top.dark")} onClick={() => setTone(tone === "dark" ? "light" : "dark")}>
        {tone === "dark" ? <Sun size={17} /> : <Moon size={17} />}
      </IconButton>
      {onLogout && (
        <div ref={ref} className="relative">
          <IconButton label={t("top.account")} onClick={() => setOpen((v) => !v)}>
            <UserCircle2 size={19} />
          </IconButton>
          {open && (
            <div role="menu" className="absolute top-11 right-0 z-40 w-56 rounded-card bg-overlay p-1.5 shadow-e2 animate-pop-in">
              {account && <div className="px-3 py-2 text-meta text-muted">{t("top.signed_in_as", { name: account })}</div>}
              <button role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 rounded-ctl px-3 py-2 text-left text-[13.5px] hover:bg-white/[.06]">
                <LogOut size={15} />
                {t("top.logout")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
