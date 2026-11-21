// Inhalte der Tabs im Popup „Instanz-Einstellungen“. Alle Optionen der früheren Einstellungsseite sind hier
// zugeordnet: Allgemein (Name, Icon, Farbe, Gruppe, Auto-Update, Notizen, Verknüpfung), Version & Loader,
// Client (Client-Packs), Java & Speicher, Fenster & Start (Fenster, Start-Befehle, Wrapper, Spieloptionen),
// Vibe (Relay), Erweitert (Umgebungsvariablen, Export, Duplizieren, Ordner,
// Reparieren, Löschen).
export type { TabProps } from "./panels/types";
export { GeneralTab } from "./panels/GeneralTab";
export { ClientTab, VersionTab } from "./panels/VersionTab";
export { JavaTab } from "./panels/JavaTab";
export { LaunchTab } from "./panels/LaunchTab";
export { VibeTab } from "./panels/VibeTab";
export { AdvancedTab } from "./panels/AdvancedTab";
