// Globale Server-Dialoge (in der Shell eingebunden): Neuer Server, EULA vor dem ersten Start,
// Schließen mit laufenden Servern.
import { useState } from "react";
import { ExternalLink, Power, PowerOff } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Dialog, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { acceptEulaAndStart, useServerDialogs } from "./actions";
import { NewServerDialog } from "./NewServerDialog";
import { ChoiceCard } from "./new/ChoiceCard";

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
        <a href={EULA_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 self-start rounded-xs font-medium text-accent hover:underline">
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
  const [busy, setBusy] = useState(false);
  const [stop, setStop] = useState(true);
  const close = () => useServerDialogs.setState({ quit: null });
  const quit = async () => {
    setBusy(true);
    try {
      await api.serversQuit(stop);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={running !== null}
      onOpenChange={(o) => !o && close()}
      title={running === 1 ? t("srv.quit.title_one") : t("srv.quit.title", { n: running ?? 0 })}
      size="md"
      locked={busy}
      footer={
        <>
          <Button variant="subtle" onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={stop ? <PowerOff size={14} /> : <Power size={14} />} loading={busy} autoFocus onClick={() => void quit()}>
            {t("uic.quit.close")}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label={t("uic.quit.close")} className="flex flex-col gap-2.5 pb-1">
        <ChoiceCard icon={<PowerOff size={19} />} title={t("uic.quit.stop")} text={t("uic.quit.stop.text")} selected={stop} disabled={busy} onSelect={() => setStop(true)} />
        <ChoiceCard icon={<Power size={19} />} title={t("uic.quit.keep")} text={t("uic.quit.keep.text")} selected={!stop} disabled={busy} onSelect={() => setStop(false)} />
      </div>
    </Dialog>
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
