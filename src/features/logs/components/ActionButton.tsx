import { useState } from "react";
import { Cpu, Download, MemoryStick, Power, PowerOff, UploadCloud, Wrench } from "lucide-react";
import { errorMessage } from "@/lib/api";
import type { DiagnosisAction, Instance } from "@/lib/types";
import { Button, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { DriverHelp } from "@/features/perf/DriverHelp";
import { runAction } from "../diagnosisActions";

export function ActionButton({ a, inst, crashReport, onDone }: { a: DiagnosisAction; inst: Instance; crashReport: string | null; onDone: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (a.kind === "update_drivers") return <DriverHelp />;
  const label =
    a.kind === "disable_mod"
      ? t("diag.act.disable")
      : a.kind === "enable_mod"
        ? t("diag.act.enable", { mod: a.name ?? a.file.replace(/\.jar\.disabled$/, "") })
        : a.kind === "install_dependency"
        ? t("diag.act.install", { mod: a.name ?? a.mod_id })
        : a.kind === "update_mod" || a.kind === "reset_config"
        ? t("diag.act.fix")
        : a.kind === "set_java"
          ? t("diag.act.java", { major: a.major })
          : a.kind === "increase_ram"
            ? t("diag.act.ram", { gb: Math.round(a.suggest_mb / 1024) })
            : t("logs.upload");
  const icon =
    a.kind === "disable_mod" ? (
      <PowerOff size={13} />
    ) : a.kind === "enable_mod" ? (
      <Power size={13} />
    ) : a.kind === "install_dependency" ? (
      <Download size={13} />
    ) : a.kind === "set_java" ? (
      <Cpu size={13} />
    ) : a.kind === "increase_ram" ? (
      <MemoryStick size={13} />
    ) : a.kind === "update_mod" || a.kind === "reset_config" ? (
      <Wrench size={13} />
    ) : (
      <UploadCloud size={13} />
    );
  return (
    <Button
      size="sm"
      variant={a.kind === "upload" ? "ghost" : "accent"}
      icon={icon}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await runAction(a, inst, crashReport);
          if (a.kind !== "upload" && a.kind !== "update_mod" && a.kind !== "reset_config") onDone();
        } catch (e) {
          toast.error(errorMessage(e), t("diag.err.action"));
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
