import { copyText as writeText } from "@/components/content/util";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { Pack } from "@/lib/vibe-sdk";
import { Button, Field, Input } from "@/components/ui";
import { useT } from "@/i18n";

function CopyRow({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-[12px]" onFocus={(e) => e.target.select()} />
        <Button
          icon={done ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
          onClick={() =>
            writeText(value).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            })
          }
        >
          {t("social.copy")}
        </Button>
      </div>
    </Field>
  );
}

export function ShareResult({ pack }: { pack: Pack }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center gap-3 rounded-card bg-ok/10 p-3 text-[13px] text-text">
        <Check size={16} className="text-ok" />
        {t("social.share.done", { name: pack.name })}
      </div>
      <CopyRow label={t("social.share.link")} value={pack.url} />
      <CopyRow label={t("social.share.code")} value={pack.code} />
      <CopyRow label={t("social.share.deeplink")} value={pack.deepLink} />
    </div>
  );
}
