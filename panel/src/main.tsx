import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/api/transport";
import { Toaster } from "@/components/ui";
import { GatewayApp } from "@/app/GatewayApp";
import { LocalApp } from "@/app/LocalApp";
import { detectMode, initRuntime } from "@/app/runtime";
import "@/styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

async function boot() {
  await initRuntime();
  const mode = detectMode();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {mode === "gateway" ? <GatewayApp /> : <LocalApp />}
        <Toaster />
      </QueryClientProvider>
    </StrictMode>,
  );
}

boot();
