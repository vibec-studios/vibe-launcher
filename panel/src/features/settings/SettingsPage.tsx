import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { useAgent } from "@/app/agent";
import { ago } from "@/app/format";
import { setTone, useTone } from "@/app/theme";
import { setLang, useLang, useT } from "@/i18n";
import { Badge, Card, Notice, Row, Segmented, Spinner } from "@/components/ui";
import { PageTitle } from "@/components/Shell";
import { AgentCard } from "./AgentCard";
import { GatewayCard } from "./GatewayCard";
import { UsersCard } from "./UsersCard";

function AuditCard() {
  const t = useT();
  const { api, key } = useAgent();
  const audit = useQuery({ queryKey: [key, "audit"], queryFn: () => api.audit(50) });
  return (
    <Card title={t("audit.title")} desc={t("audit.desc")}>
      {audit.isLoading ? (
        <Spinner />
      ) : audit.error ? (
        <Notice tone="danger">{(audit.error as Error).message}</Notice>
      ) : (
        <ul className="max-h-80 overflow-y-auto">
          {audit.data?.map((e, i) => (
            <li key={i} className="flex items-center gap-3 border-b border-line py-2 text-[13px] last:border-b-0">
              {e.ok ? <CheckCircle2 size={15} className="shrink-0 text-ok" /> : <XCircle size={15} className="shrink-0 text-danger" />}
              <span className="w-24 shrink-0 truncate font-medium">{e.user_name ?? "–"}</span>
              <code className="shrink-0 font-mono text-[12px] text-accent">{e.action}</code>
              <span className="min-w-0 flex-1 truncate text-muted">{e.target}</span>
              <Badge>{t(`audit.via.${e.via}`)}</Badge>
              <span className="hidden w-28 shrink-0 text-right text-meta text-dim sm:block">{ago(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AppearanceCard() {
  const t = useT();
  const tone = useTone();
  const lang = useLang();
  return (
    <Card title={t("look.title")} desc={t("look.desc")}>
      <Row title={t("look.tone")}>
        <Segmented value={tone} onChange={setTone} items={[{ key: "dark", label: t("look.dark") }, { key: "light", label: t("look.light") }]} />
      </Row>
      <Row title={t("look.lang")}>
        <Segmented value={lang} onChange={setLang} items={[{ key: "de", label: "Deutsch" }, { key: "en", label: "English" }]} />
      </Row>
    </Card>
  );
}

export function SettingsPage() {
  const t = useT();
  const { can } = useAgent();
  const admin = can("agent.admin");
  return (
    <>
      <PageTitle title={t("settings.title")} desc={t("settings.desc")} />
      <div className="flex flex-col gap-4">
        {admin ? (
          <>
            <AgentCard />
            <GatewayCard />
            <UsersCard />
            <AuditCard />
          </>
        ) : (
          <Notice tone="info">{t("settings.no_admin")}</Notice>
        )}
        <AppearanceCard />
      </div>
    </>
  );
}
