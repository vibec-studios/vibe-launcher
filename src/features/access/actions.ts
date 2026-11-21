import { queryClient, qk } from "@/lib/queries";
import { patchSettings } from "@/lib/mode";
import type { Settings } from "@/lib/types";
import { t } from "@/i18n";
import { connect, useSocial } from "@/features/social/service";
import { accessCache } from "./cache";
import { hasAccessClient, requestAccess } from "./store";

export async function joinWaitlist(note = "") {
  const social = useSocial.getState();
  if (hasAccessClient() && social.linked && social.conn !== "logged_out" && social.conn !== "logging_in") {
    await requestAccess(note);
    return;
  }
  if (social.conn === "no_account") throw new Error(t("access.err.no_account"));
  accessCache.setPendingJoin(note);
  const settings = queryClient.getQueryData<Settings>(qk.settings);
  if (settings && !settings.vibe.enabled) {
    await patchSettings({ vibe: { ...settings.vibe, enabled: true } });
    return;
  }
  await connect();
}

export function planWaitlistJoin() {
  if (!accessCache.pendingJoin()) accessCache.setPendingJoin("");
}

export function cancelWaitlistPlan() {
  accessCache.setPendingJoin(null);
}
