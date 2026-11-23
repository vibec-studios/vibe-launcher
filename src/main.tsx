import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/globals.css";
import "./styles/themes.css";
import "./styles/v2.css";
import "./styles/custom.css";
import "./styles/pixel.css";
import "./styles/zoom.css";
import { queryClient } from "@/lib/queries";
import { router } from "@/app/router";
import { installGuards } from "@/app/guards";
import { EventBridge } from "@/app/EventBridge";
import { RemoteBridge } from "@/features/remote/RemoteBridge";
import { TextMenuHost } from "@/app/TextMenu";
import { ConfirmHost, Toaster, TooltipProvider } from "@/components/ui";
import { GlobalDropZone } from "@/features/import/GlobalDropZone";
import { UpdateChecker } from "@/app/UpdateNotice";
import { LeanBridge } from "@/features/lean/LeanBridge";
import { i18nReady, useLang } from "@/i18n";
import { applyCachedAppearance } from "@/lib/appearance";
import { applyCachedThemeExt } from "@/features/themes/ThemeHost";

// Simuliertes Backend nur für Frontend-Entwicklung im Browser (VITE_MOCK=1)
if (import.meta.env.VITE_MOCK === "1") await import("@/dev/mock");

await i18nReady;
installGuards();
applyCachedAppearance();
applyCachedThemeExt();
document.documentElement.lang = useLang.getState().lang;
document.documentElement.dataset.mode = useLang.getState().simple ? "simple" : "expert";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={350} skipDelayDuration={150}>
        <EventBridge />
        <RemoteBridge />
        <RouterProvider router={router} />
        <GlobalDropZone />
        <ConfirmHost />
        <TextMenuHost />
        <Toaster />
        <UpdateChecker />
        <LeanBridge />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

// Fenster erst zeigen, wenn der erste Frame gezeichnet ist -> kein weißer Blitz.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    getCurrentWindow()
      .show()
      .then(() => getCurrentWindow().setFocus())
      .catch(() => {});
  }),
);
