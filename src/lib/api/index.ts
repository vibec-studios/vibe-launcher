export { errorMessage, isCancelled } from "./call";
import { instancesApi } from "./instances";
import { systemApi } from "./system";
import { accountsApi } from "./accounts";
import { gameApi } from "./game";
import { contentApi } from "./content";
import { serversApi } from "./servers";
import { platformApi } from "./platform";
import { vibeApi } from "./vibe";
import { filesApi } from "./files";
import { feedbackApi } from "./feedback";
import { ticketsApi } from "./tickets";

export const api = {
  ...instancesApi,
  ...systemApi,
  ...accountsApi,
  ...gameApi,
  ...contentApi,
  ...serversApi,
  ...platformApi,
  ...vibeApi,
  ...filesApi,
  ...feedbackApi,
  ...ticketsApi,
};
