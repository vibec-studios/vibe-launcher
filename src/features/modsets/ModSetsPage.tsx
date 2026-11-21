// OWNER: Content-Agent. Mod-Sets: Übersicht aller Sets (Bibliothek → Mod-Sets) und Editor eines Sets
// (`/modsets?set=<id>`): Inhalte, Hinzufügen (Suche / Liste einfügen / aus Instanz), Kompatibilität, Teilen.
import { SetEditor } from "./components/SetEditor";
import { SetsOverview } from "./components/SetsOverview";
import { route } from "./route";

export function ModSetsPage() {
  const { set } = route.useSearch();
  return set ? <SetEditor key={set} id={set} /> : <SetsOverview />;
}
