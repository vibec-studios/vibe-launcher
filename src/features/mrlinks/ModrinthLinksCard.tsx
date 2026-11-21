import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Button, Input, SettingRow, SettingsCard, Switch, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { looksLikeModrinthLink, mrLinksApi } from "./api";
import { useOpenLink } from "./useOpenLink";

const KEY = ["modrinth-links-status"];

export function ModrinthLinksCard() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: mrLinksApi.status, staleTime: 30_000 });
  const m = useMutation({
    mutationFn: mrLinksApi.set,
    onSuccess: (s) => {
      qc.setQueryData(KEY, s);
      toast.success(t(s.enabled ? "mrlink.on_done" : "mrlink.off_done"));
    },
    onError: (e) => toast.error(e),
  });
  const [link, setLink] = useState("");
  const { openLink, busy } = useOpenLink();
  const s = q.data;
  const linkOk = looksLikeModrinthLink(link);

  const status = !s ? null : s.enabled ? t("mrlink.status_vibe") : s.other ? t("mrlink.status_other", { app: s.other }) : t("mrlink.status_none");

  return (
    <SettingsCard title={t("mrlink.section")} id="set-mrlinks">
      {s?.supported !== false && (
        <SettingRow
          title={t("mrlink.toggle")}
          description={
            <>
              {t("mrlink.toggle_desc")}
              {status && <span className={s?.enabled ? " text-ok" : " text-dim"}> {status}</span>}
              {s?.enabled && <span className="mt-1 block text-dim">{t("mrlink.restore_hint")}</span>}
            </>
          }
        >
          <Switch checked={!!s?.enabled} disabled={!s || m.isPending} onChange={(v) => m.mutate(v)} label={t("mrlink.toggle")} />
        </SettingRow>
      )}
      <SettingRow title={t("mrlink.open")} description={t("mrlink.open_desc")} stacked>
        <form
          className="flex w-full items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (linkOk) void openLink(link).then((ok) => ok && setLink(""));
          }}
        >
          <Input
            className="min-w-0 flex-1"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://modrinth.com/mod/sodium"
            invalid={link.trim() !== "" && !linkOk}
            spellCheck={false}
            aria-label={t("mrlink.open")}
          />
          <Button type="submit" variant="primary" icon={<ExternalLink size={14} />} disabled={!linkOk} loading={busy}>
            {t("mrlink.open_button")}
          </Button>
        </form>
      </SettingRow>
    </SettingsCard>
  );
}
