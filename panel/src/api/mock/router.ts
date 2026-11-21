import { ApiError, type RequestOptions } from "../transport";

export interface Ctx {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  raw: Blob | string | undefined;
  opts: RequestOptions;
}

type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class MockRouter {
  private routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler) {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
    return this;
  }

  async handle(method: string, path: string, opts: RequestOptions = {}): Promise<unknown> {
    const segs = path.split("/").filter(Boolean).map(decodeURIComponent);
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      const ok = r.parts.every((p, i) => {
        if (p.startsWith(":")) {
          params[p.slice(1)] = segs[i];
          return true;
        }
        return p === segs[i];
      });
      if (!ok) continue;
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null) query[k] = String(v);
      return r.handler({ params, query, body: opts.body, raw: opts.raw, opts });
    }
    throw new ApiError(404, "not_found", `Mock: ${method} ${path} ist nicht im Vertrag`);
  }
}

export function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
