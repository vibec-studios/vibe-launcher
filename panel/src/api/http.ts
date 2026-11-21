import { ApiError, buildQuery, type RequestOptions } from "./transport";

export interface HttpAuth {
  bearer?: string | null;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  onUnauthorized?: () => void;
}

async function parseError(status: number, text: string): Promise<ApiError> {
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string; kind?: string } };
    if (body.error) return new ApiError(status, body.error.code ?? "internal", body.error.message ?? text, body.error.kind);
  } catch {
    /* kein JSON */
  }
  const code = status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 429 ? "rate_limited" : "internal";
  return new ApiError(status, code, text || `HTTP ${status}`);
}

function headersFor(auth: HttpAuth, opts: RequestOptions): Record<string, string> {
  const h: Record<string, string> = { "X-Vibe-Api": "1", ...auth.headers };
  if (auth.bearer) h.Authorization = `Bearer ${auth.bearer}`;
  if (opts.raw !== undefined) h["Content-Type"] = opts.contentType ?? "application/octet-stream";
  else if (opts.body !== undefined) h["Content-Type"] = "application/json";
  return h;
}

function decode<T>(status: number, text: string, blob: Blob | null, as: RequestOptions["as"]): T {
  if (as === "blob") return blob as T;
  if (as === "text") return text as T;
  if (status === 204 || !text) return undefined as T;
  return JSON.parse(text) as T;
}

function xhrRequest<T>(url: string, method: string, auth: HttpAuth, opts: RequestOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.withCredentials = auth.credentials === "include";
    for (const [k, v] of Object.entries(headersFor(auth, opts))) xhr.setRequestHeader(k, v);
    if (opts.as === "blob") xhr.responseType = "blob";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "Keine Verbindung"));
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const blob = opts.as === "blob" ? (xhr.response as Blob) : null;
        resolve(decode<T>(xhr.status, opts.as === "blob" ? "" : xhr.responseText, blob, opts.as));
      } else {
        if (xhr.status === 401) auth.onUnauthorized?.();
        const text = opts.as === "blob" ? await (xhr.response as Blob).text() : xhr.responseText;
        reject(await parseError(xhr.status, text));
      }
    };
    opts.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : null));
  });
}

export async function httpRequest<T>(base: string, method: string, path: string, auth: HttpAuth, opts: RequestOptions = {}): Promise<T> {
  const url = `${base}${path}${buildQuery(opts.query)}`;
  if (opts.onProgress) return xhrRequest<T>(url, method, auth, opts);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: headersFor(auth, opts),
      credentials: auth.credentials ?? "same-origin",
      body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network", "Keine Verbindung");
  }
  if (!res.ok) {
    if (res.status === 401) auth.onUnauthorized?.();
    throw await parseError(res.status, await res.text());
  }
  if (opts.as === "blob") return (await res.blob()) as T;
  return decode<T>(res.status, await res.text(), null, opts.as);
}
