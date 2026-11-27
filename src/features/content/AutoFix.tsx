// „Probleme beheben“ in einem Klick: Plan laden (Abhängigkeiten, Konflikte, letzte Crash-Analyse), Vorschau
// („Das wird gemacht“) mit abwählbaren Schritten, ausführen (vorher Snapshot) und Zusammenfassung mit „Rückgängig“.
// Nach einem Absturz stehen die erkannten Ursachen oben (Erklärung, Fundstelle, zugehörige Schritte); der Bericht
// zeigt je Ursache „behoben“ / „nicht automatisch lösbar“ und bietet „Testen“ (erneute Prüfung ohne den alten Absturz).
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n";
import { openAutofix, useAutofix, type FixRequest } from "./autofixStore";
import { AutofixDialog } from "./autofix/AutofixDialog";

export { causeStatus, type Verify } from "./autofix/status";

export function AutofixHost() {
  const req = useAutofix((s) => s.req);
  return req ? <AutofixDialog key={`${req.instanceId}:${req.crashReport ?? ""}`} req={req} onClose={() => useAutofix.setState({ req: null })} /> : null;
}

/** Knopf „Probleme beheben“ (Hinweiszeile, Crash-Banner, Crash-Dialog). */
export function AutofixButton({
  req,
  size = "sm",
  variant = "accent",
  className,
  label,
}: {
  req: FixRequest;
  size?: "sm" | "md";
  variant?: "accent" | "ghost";
  className?: string;
  label?: string;
}) {
  const t = useT();
  return (
    <Button size={size} variant={variant} data-tour="autofix" icon={<Wrench size={13} />} className={className} onClick={() => openAutofix(req)}>
      {label ?? t("fix.button")}
    </Button>
  );
}
