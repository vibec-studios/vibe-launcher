import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useOnboarding } from "@/features/onboarding/store";
import { useSettings } from "@/lib/queries";

export function LibraryPreload() {
  const router = useRouter();
  const home = useRouterState({ select: (s) => s.location.pathname === "/" });
  const onboarded = useSettings().data?.onboarding_done;
  const onboarding = useOnboarding((s) => s.open);
  const preloaded = useRef(false);

  useEffect(() => {
    if (!home || !onboarded || onboarding || preloaded.current) return;

    let idle: number | undefined;
    const delay = window.setTimeout(() => {
      idle = window.requestIdleCallback(() => {
        if (document.visibilityState !== "visible") return;
        preloaded.current = true;
        void router.preloadRoute({ to: "/instances" });
      });
    }, 400);

    return () => {
      window.clearTimeout(delay);
      if (idle !== undefined) window.cancelIdleCallback(idle);
    };
  }, [home, onboarded, onboarding, router]);

  return null;
}
