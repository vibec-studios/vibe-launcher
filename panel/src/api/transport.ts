import type { AgentEventMap, AgentEventName } from "./types";

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  raw?: Blob | string;
  contentType?: string;
  as?: "json" | "text" | "blob";
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export type SocketState = "connecting" | "open" | "closed";

export interface AgentSocket {
  on<E extends AgentEventName>(event: E, handler: (data: AgentEventMap[E]) => void): () => void;
  onState(handler: (state: SocketState) => void): () => void;
  subscribe(topics: string[]): void;
  unsubscribe(topics: string[]): void;
  close(): void;
}

export interface Transport {
  readonly kind: "local" | "gateway" | "mock";
  request<T>(method: string, path: string, opts?: RequestOptions): Promise<T>;
  openSocket(): AgentSocket;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly kind?: string,
  ) {
    super(message);
  }
}

export function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}
