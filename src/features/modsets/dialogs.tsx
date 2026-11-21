// OWNER: Content-Agent. Mod-Sets erstellen/füllen: Liste einfügen, Importieren (Code/Datei), Neues Set, Aus Instanz.
import { ApplyDialog } from "./ApplyDialog";
import { useSetDialogs } from "./shared";
import { CreateSetDialog } from "./components/CreateSetDialog";
import { FromInstanceDialog } from "./components/FromInstanceDialog";
import { ImportSetDialog } from "./components/ImportSetDialog";

// ------------------------------------------------------------------ Host

/** Globale Mod-Set-Dialoge (in der Shell eingehängt). */
export function ModSetsHost() {
  const s = useSetDialogs();
  const close = (k: "apply" | "fromInstance" | "importOpen" | "createOpen") => useSetDialogs.setState({ [k]: k === "apply" || k === "fromInstance" ? null : false });
  return (
    <>
      {s.apply && <ApplyDialog key={`${s.apply.instanceId}:${s.apply.setIds.join(",")}`} {...s.apply} onClose={() => close("apply")} />}
      {s.fromInstance && <FromInstanceDialog {...s.fromInstance} onClose={() => close("fromInstance")} />}
      {s.importOpen && <ImportSetDialog onClose={() => close("importOpen")} />}
      {s.createOpen && <CreateSetDialog onClose={() => close("createOpen")} />}
    </>
  );
}
