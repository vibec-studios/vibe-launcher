// Globale Server-Dialoge (in der Shell eingebunden): Neuer Server, EULA vor dem ersten Start,
// Schließen mit laufenden Servern.
import { useState } from "react";
import { ExternalLink, Power, PowerOff } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Dialog, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { acceptEulaAndStart, useServerDialogs } from "./actions";
import { NewServerDialog } from "./NewServerDialog";

const EULA_URL = "https://aka.ms/MinecraftEULA";

function EulaDialog() {
  const t = useT();
  const server = useServerDialogs((s) => s.eulaFor);
  const [busy, setBusy] = useState(false);
  const close = () => useServerDialogs.setState({ eulaFor: null });
  return (
    <Dialog
      open={!!server}
      onOpenChange={(o) => !o && close()}
      title={t("srv.eula.title")}
      description={server?.name}
      size="sm"
      locked={busy}
      footer={
        <>
          <Button variant="subtle" onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="accent"
            loading={busy}
            autoFocus
            onClick={async () => {
              if (!server) return;
              setBusy(true);
              await acceptEulaAndStart(server);
              setBusy(false);
              close();
            }}
          >
            {t("srv.eula.accept")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-muted">
        <p>{t("srv.eula.text")}</p>
        <a href={EULA_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 self-start font-medium text-accent hover:brightness-125">
          <ExternalLink size={13} />
          {t("srv.eula.link")}
        </a>
      </div>
    </Dialog>
  );
}

function QuitDialog() {
  const t = useT();
  const running = useServerDialogs((s) => s.quit);
  const [busy, setBusy] = useState<"stop" | "keep" | null>(null);
  const close = () => useServerDialogs.setState({ quit: null });
  const quit = async (stop: boolean) => {
    setBusy(stop ? "stop" : "keep");
    try {
      await api.serversQuit(stop);
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };
  return (
    <Dialog
      open={running !== null}
      onOpenChange={(o) => !o && close()}
      title={running === 1 ? t("srv.quit.title_one") : t("srv.quit.title", { n: running ?? 0 })}
      description={t("srv.quit.text")}
      size="lg"
      locked={!!busy}
      footer={
        <>
          <Button variant="subtle" className="mr-auto" onClick={close} disabled={!!busy}>
            {t("common.cancel")}
          </Button>
          <Button icon={<Power size={14} />} loading={busy === "keep"} disabled={!!busy} onClick={() => quit(false)}>
            {t("srv.quit.keep")}
          </Button>
          <Button variant="accent" icon={<PowerOff size={14} />} loading={busy === "stop"} disabled={!!busy} autoFocus onClick={() => quit(true)}>
            {t("srv.quit.stop")}
          </Button>
        </>
      }
    />
  );
}

export function ServerDialogs() {
  const newOpen = useServerDialogs((s) => s.newOpen);
  const fromInstance = useServerDialogs((s) => s.fromInstance);
  return (
    <>
      <NewServerDialog open={newOpen} fromInstance={fromInstance} onOpenChange={(o) => useServerDialogs.setState({ newOpen: o })} />
      <EulaDialog />
      <QuitDialog />
    </>
  );
}
