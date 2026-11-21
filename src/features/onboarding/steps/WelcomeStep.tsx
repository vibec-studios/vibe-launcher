import { Check } from "lucide-react";
import { Logo3D } from "@/components/Logo3D";
import { cn } from "@/components/ui";
import { patchSettings } from "@/lib/mode";
import { LANGUAGES, useLang, useT, type Lang } from "@/i18n";

export function WelcomeStep() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const setLang = (l: Lang) => {
    useLang.getState().setLang(l);
    patchSettings({ language: l }).catch(() => {});
  };
  return (
    <div className="flex flex-col items-center text-center">
      <Logo3D size={132} />
      <h1 className="mt-6 text-[34px] font-bold leading-tight tracking-[-0.02em] text-text">{t("onb.welcome.title")}</h1>
      <p className="mt-2 max-w-[520px] text-[15px] leading-relaxed text-muted">{t("onb.welcome.lead")}</p>
      <div className="mt-9 text-[12.5px] font-semibold text-dim">{t("onb.welcome.lang")}</div>
      <div className="mt-3 flex w-full max-w-[600px] flex-wrap justify-center gap-2.5" role="radiogroup" aria-label={t("onb.welcome.lang")}>
        {LANGUAGES.map(({ code: l, name }) => (
          <button
            key={l}
            role="radio"
            aria-checked={lang === l}
            onClick={() => setLang(l)}
            className={cn(
              "flex h-12 min-w-[132px] items-center justify-center gap-2 rounded-card bg-surface px-4 text-[14.5px] font-semibold text-text transition-[background-color,box-shadow] duration-150",
              lang === l ? "bg-surface2 shadow-[inset_0_0_0_2px_var(--ui-accent)]" : "hover:bg-surface2",
            )}
          >
            {lang === l && <Check size={16} strokeWidth={2.5} className="text-brand" />}
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
