// Vibe-Online-Dienste (optional). Jedes Vibe-UI-Element fragt hier, ob es sichtbar sein darf:
//   const vibe = useVibe(); if (!vibe.sharing) return null;
// Ist der Hauptschalter aus, sind alle Teilbereiche aus.
import { useSettings } from "./queries";

export interface VibeFlags {
  /** Hauptschalter */
  enabled: boolean;
  /** Freunde, Chats, Einladungen */
  social: boolean;
  /** Online-Status an Freunde */
  presence: boolean;
  /** Welten/Server über den Relay hosten */
  hosting: boolean;
  /** Modpacks per Link/Code teilen */
  sharing: boolean;
  apiUrl: string;
}

export function useVibe(): VibeFlags {
  const v = useSettings().data?.vibe;
  const on = !!v?.enabled;
  return {
    enabled: on,
    social: on && !!v?.social,
    presence: on && !!v?.presence,
    hosting: on && !!v?.hosting,
    sharing: on && !!v?.sharing,
    apiUrl: v?.api_url ?? "",
  };
}
