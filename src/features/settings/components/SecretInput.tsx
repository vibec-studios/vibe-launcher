import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";

export function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <Input
      type={show ? "text" : "password"}
      className="w-full max-w-[420px] font-mono text-[12px]"
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      trailing={
        <Tooltip content={show ? t("settings.hide") : t("settings.show")}>
          <button
            type="button"
            aria-label={show ? t("settings.hide") : t("settings.show")}
            className="grid h-6 w-6 place-items-center rounded-ctl text-dim hover:bg-white/[.07] hover:text-text"
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </Tooltip>
      }
    />
  );
}
