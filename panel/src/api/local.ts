import { httpRequest } from "./http";
import { WsSocket, wsUrl } from "./socket";
import type { RequestOptions, Transport } from "./transport";

export function agentBaseUrl(): string {
  const override = import.meta.env.VITE_AGENT_URL as string | undefined;
  return `${override ? override.replace(/\/+$/, "") : ""}/api/v1`;
}

export function createLocalTransport(token: string | null, onUnauthorized: () => void): Transport {
  const base = agentBaseUrl();
  return {
    kind: "local",
    request: <T>(method: string, path: string, opts?: RequestOptions) =>
      httpRequest<T>(base, method, path, { bearer: token, onUnauthorized }, opts),
    openSocket: () => new WsSocket({ url: wsUrl(base, "/ws"), token }),
  };
}
