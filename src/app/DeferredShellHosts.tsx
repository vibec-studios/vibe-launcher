import { DeferredMount } from "@/components/DeferredMount";
import { useAccountConflict } from "@/components/instance/AccountConflict";
import { useInstanceDialogs } from "@/components/instance/actions";
import { useAutofix } from "@/features/content/autofixStore";
import { useFeedback } from "@/features/feedback/store";
import { useHelp } from "@/features/help/store";
import { useTours } from "@/features/help/tour/store";
import { useSetDialogs } from "@/features/modsets/shared";
import { useShareLog } from "@/features/vibefix/shareStore";
import { useOnboarding } from "@/features/onboarding/store";
import { useServerDialogs } from "@/features/servers/actions";
import { useSocialDialogs } from "@/features/social/dialogStore";
import { useSocial } from "@/features/social/service";
import { useSettings } from "@/lib/queries";
import { useVibe } from "@/lib/vibe";
import { ErrorBoundary } from "./ErrorBoundary";

const loadInstanceDialogs = () => import("@/features/instances/InstanceDialogs").then((m) => m.InstanceDialogs);
const loadAutofixHost = () => import("@/features/content/AutoFix").then((m) => m.AutofixHost);
const loadServerDialogs = () => import("@/features/servers/ServerDialogs").then((m) => m.ServerDialogs);
const loadModSetsHost = () => import("@/features/modsets/dialogs").then((m) => m.ModSetsHost);
const loadSocialDialogs = () => import("@/features/social/dialogs").then((m) => m.SocialDialogs);
const loadFeedbackDialog = () => import("@/features/feedback/FeedbackDialog").then((m) => m.FeedbackDialog);
const loadHelpCenter = () => import("@/features/help/HelpCenter").then((m) => m.HelpCenter);
const loadTourHost = () => import("@/features/help/tour/TourHost").then((m) => m.TourHost);
const loadOnboarding = () => import("@/features/onboarding/Onboarding").then((m) => m.Onboarding);
const loadShareLog = () => import("@/features/vibefix/ShareLogDialog").then((m) => m.ShareLogHost);
const loadFriendsPanel = () => import("@/features/social/FriendsPanel").then((m) => m.FriendsPanel);

export function DeferredShellHosts() {
  const instance = useInstanceDialogs((s) => s.newOpen || !!s.exportFor || !!s.groupFor || !!s.iconFor);
  const accountConflict = useAccountConflict((s) => !!s.ask);
  const autofix = useAutofix((s) => !!s.req || !!s.pre);
  const share = useShareLog((s) => !!s.req);
  const server = useServerDialogs((s) => s.newOpen || !!s.eulaFor || s.quit !== null);
  const sets = useSetDialogs((s) => !!s.apply || !!s.fromInstance || s.importOpen || s.createOpen);
  const social = useSocialDialogs((s) => !!(s.inviteFriends || s.accept || s.share || s.pack || s.newGroup || s.addMembers || s.rename));
  const feedback = useFeedback((s) => s.open);
  const help = useHelp((s) => s.open);
  const tour = useTours((s) => !!s.active);
  const onboarding = useOnboarding((s) => s.open);
  const settings = useSettings().data;

  return (
    <>
      <DeferredMount active={sets} load={loadModSetsHost} />
      <DeferredMount active={instance || accountConflict} load={loadInstanceDialogs} />
      <DeferredMount active={autofix} load={loadAutofixHost} />
      <DeferredMount active={share} load={loadShareLog} />
      <DeferredMount active={server} load={loadServerDialogs} />
      <DeferredMount active={social} load={loadSocialDialogs} />
      <ErrorBoundary>
        <DeferredMount active={feedback} load={loadFeedbackDialog} />
      </ErrorBoundary>
      <ErrorBoundary>
        <DeferredMount active={help} load={loadHelpCenter} />
      </ErrorBoundary>
      <ErrorBoundary>
        <DeferredMount active={tour} load={loadTourHost} />
      </ErrorBoundary>
      {(onboarding || (!!settings && !settings.onboarding_done)) && (
        <DeferredMount active load={loadOnboarding} />
      )}
    </>
  );
}

export function FriendsPanelHost() {
  const open = useSocial((s) => s.panelOpen);
  const { social } = useVibe();
  return open && social && <DeferredMount active load={loadFriendsPanel} />;
}
