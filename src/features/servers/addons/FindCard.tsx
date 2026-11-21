import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import type { Server } from "@/lib/types";
import { formatLoader } from "@/lib/format";
import { Button, SearchInput, SettingsCard } from "@/components/ui";
import { useT } from "@/i18n";
import { serverSoftware } from "../addonsApi";
import { serverKeyOf } from "@/features/installtarget/registry";

export function FindCard({ server, plugins }: { server: Server; plugins: boolean }) {
  const t = useT();
  const nav = useNavigate();
  const [query, setQuery] = useState("");
  const go = (q?: string, extra?: string) =>
    nav({ to: "/discover", search: { server: serverKeyOf(server.id), q: q?.trim() || undefined, p: extra } });
  return (
    <SettingsCard title={plugins ? t("srv.addons.find.plugins") : t("srv.addons.find.mods")}>
      <div className="flex flex-col gap-3 p-4" data-testid="addons-find">
        <p className="text-[13px] leading-relaxed text-muted">
          {t(plugins ? "st.find.text_plugins" : "st.find.text_mods", { software: serverSoftware(server, formatLoader), mc: server.mc_version })}
        </p>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go(query);
          }}
        >
          <div className="min-w-0 flex-1">
            <SearchInput value={query} onChange={setQuery} placeholder={plugins ? t("srv.addons.search.plugins") : t("srv.addons.search.mods")} />
          </div>
          <Button type="submit" variant="primary" icon={<Compass size={14} />}>
            {t("st.find.open")}
          </Button>
        </form>
      </div>
    </SettingsCard>
  );
}
