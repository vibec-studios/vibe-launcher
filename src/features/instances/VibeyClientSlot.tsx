// Reservierter Platz für die „Vibey Client“-Option einer Instanz (Ein/Aus, Update).
//
// TODO(Vibey-Client-Delegate): Hier die Steuerung einbauen. Die Kopfzeile der Instanzseite rendert diese
// Komponente direkt links neben dem Spielen-Knopf (siehe InstanceHeader.tsx). Vorgaben, damit die Kopfzeile ruhig
// bleibt:
//   - höchstens ein kompaktes Element in Knopfhöhe (h-11, eckig), z. B. ein Umschalter „Vibey Client“ mit
//     Statuspunkt; ein verfügbares Update als kleiner Hinweis im selben Element oder als Menüpunkt
//   - nichts rendern (null), wenn die Option für diese Instanz nicht verfügbar ist (Vanilla, falscher Loader …)
//   - weitere Einstellungen gehören in den Bereich „Einstellungen → Allgemein“, nicht in die Kopfzeile
// Bis dahin rendert der Platzhalter nichts.
import type { Instance } from "@/lib/types";

export function VibeyClientSlot(_props: { instance: Instance }) {
  return null;
}
