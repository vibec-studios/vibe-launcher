import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/globals.css";
import { queryClient } from "@/lib/queries";
import { router } from "@/app/router";
import { installGuards } from "@/app/guards";
import { EventBridge } from "@/app/EventBridge";
import { TextMenuHost } from "@/app/TextMenu";
import { ConfirmHost, Toaster, TooltipProvider } from "@/components/ui";
import { GlobalDropZone } from "@/features/import/GlobalDropZone";
import { UpdateNotice } from "@/app/UpdateNotice";
import { useLang } from "@/i18n";

// Simuliertes Backend nur für Frontend-Entwicklung im Browser (VITE_MOCK=1)
if (import.meta.env.VITE_MOCK === "1") await import("@/dev/mock");

installGuards();
document.documentElement.lang = useLang.getState().lang;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={350} skipDelayDuration={150}>
        <EventBridge />
        <RouterProvider router={router} />
        <GlobalDropZone />
        <ConfirmHost />
        <TextMenuHost />
        <Toaster />
        <UpdateNotice />
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
