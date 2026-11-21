import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/transport";
import { useT } from "@/i18n";
import { Button, Notice } from "@/components/ui";
import { LocalLogin } from "@/features/auth/LocalLogin";
import { AgentArea, FullscreenSpinner } from "./AgentArea";
import { AgentProvider } from "./agent";
import { segments, useHashPath } from "./router";
import { localTransport } from "./runtime";

const TOKEN_KEY = "vibe-panel.token";

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function LocalApp() {
  const t = useT();
  const qc = useQueryClient();
  const path = useHashPath();
  const [token, setToken] = useState<string | null>(readToken);
  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* privat */
    }
    qc.clear();
    setToken(null);
  }, [qc]);
  const transport = useMemo(() => localTransport(token, logout), [token, logout]);
  if (!token) {
    return (
      <LocalLogin
        transport={transport}
        onToken={(tk) => {
          try {
            localStorage.setItem(TOKEN_KEY, tk);
          } catch {
            /* privat */
          }
          setToken(tk);
        }}
      />
    );
  }
  return (
    <AgentProvider
      agentKey="local"
      transport={transport}
      base=""
      remote={false}
      fallback={({ error, loading, retry }) =>
        loading || !error ? (
          <FullscreenSpinner />
        ) : (
          <div className="mx-auto mt-24 max-w-md px-4">
            <Notice
              tone="danger"
              title={error instanceof ApiError && error.status === 0 ? t("error.unreachable") : t("error.generic")}
              actions={
                <>
                  <Button onClick={retry}>{t("common.retry")}</Button>
                  <Button variant="subtle" onClick={logout}>
                    {t("top.logout")}
                  </Button>
                </>
              }
            >
              {(error as Error).message}
            </Notice>
          </div>
        )
      }
    >
      <AgentArea rest={segments(path)} onLogout={logout} />
    </AgentProvider>
  );
}
