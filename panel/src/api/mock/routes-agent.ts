import type { Role, User } from "../types";
import { ALL_PERMISSIONS, type MockAgent } from "./agent";
import { fail, type MockRouter } from "./router";

const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

function code8(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function registerAgentRoutes(r: MockRouter, a: MockAgent) {
  r.on("GET", "/info", () => a.info);
  r.on("POST", "/pair", ({ body }) => {
    const b = body as { code?: string; client_name?: string };
    const norm = (b.code ?? "").toUpperCase().replace(/[-\s]/g, "");
    if (!CODE.test(norm) || norm === "AAAAAAAA") fail(401, "pairing_failed", "Der Code stimmt nicht oder ist abgelaufen.");
    const owner = a.users[0];
    return { token: `va_mock_${norm}`, token_id: a.nextId("tok"), user: { id: owner.id, name: owner.name, role: owner.role }, agent: { id: a.info.id, name: a.info.name, version: a.info.version, fingerprint: a.info.fingerprint } };
  });
  r.on("GET", "/me", () => ({ user: a.users[0], permissions: ALL_PERMISSIONS }));
  r.on("GET", "/agent/resources", () => a.resources());
  r.on("GET", "/agent/settings", () => a.settings);
  r.on("PATCH", "/agent/settings", ({ body }) => {
    const b = body as { name?: string; gateway_enabled?: boolean };
    if (b.name !== undefined) {
      if (!b.name.trim()) fail(400, "invalid", "Der Name darf nicht leer sein.");
      a.settings.name = b.name.trim();
      a.info.name = a.settings.name;
    }
    if (b.gateway_enabled !== undefined) {
      a.settings.gateway_enabled = b.gateway_enabled;
      a.gatewayState.enabled = b.gateway_enabled;
      a.gatewayState.connected = b.gateway_enabled && a.gatewayState.linked;
    }
    a.addAudit("Henny", "agent.settings", null);
    return a.settings;
  });
  r.on("GET", "/agent/audit", ({ query }) => a.audit.slice(0, Number(query.limit ?? 100)));
  r.on("GET", "/agent/update", () => ({ current: a.info.version, latest: "0.1.1", available: true, notes_url: "https://github.com/" }));
  r.on("POST", "/agent/update", () => ({ task_id: a.runTask("Agent-Update auf 0.1.1", "agent_update", null, () => (a.info.version = "0.1.1")) }));
  r.on("GET", "/agent/gateway", () => a.gatewayState);
  r.on("POST", "/agent/gateway/link", () => {
    setTimeout(() => {
      a.gatewayState = { enabled: true, connected: true, linked: true, vibe_user: { id: "vu_1", name: "Henny" }, last_error: null };
      a.settings.relay = { configured: true, source: "gateway", name: "Henny" };
    }, 6000);
    return { ...a.gatewayState, code: "K7Q2-M9XD", expires_at: Date.now() + 15 * 60_000 };
  });
  r.on("DELETE", "/agent/gateway/link", () => {
    a.gatewayState = { ...a.gatewayState, connected: false, linked: false, vibe_user: null };
    a.settings.relay = { configured: false, source: null, name: null };
  });
  r.on("GET", "/agent/relay", () => a.settings.relay);

  r.on("GET", "/users", () => a.users);
  r.on("POST", "/users/invite", ({ body }) => {
    const role = (body as { role?: Role }).role ?? "admin";
    a.addAudit("Henny", "user.invite", role);
    return { code: code8(), expires_at: Date.now() + 15 * 60_000 };
  });
  r.on("POST", "/pair/codes", () => ({ code: code8(), expires_at: Date.now() + 15 * 60_000 }));
  r.on("PATCH", "/users/:id", ({ params, body }) => {
    const u = a.users.find((x) => x.id === params.id);
    if (!u) fail(404, "not_found", "Benutzer nicht gefunden.");
    if (u.role === "owner") fail(403, "forbidden", "Der Besitzer kann nicht geändert werden.");
    Object.assign(u, body as Partial<User>);
    return u;
  });
  r.on("DELETE", "/users/:id", ({ params }) => {
    const u = a.users.find((x) => x.id === params.id);
    if (!u) fail(404, "not_found", "Benutzer nicht gefunden.");
    if (u.role === "owner") fail(403, "forbidden", "Der Besitzer kann nicht entfernt werden.");
    a.users = a.users.filter((x) => x.id !== params.id);
    a.addAudit("Henny", "user.remove", u.name);
  });
  r.on("POST", "/tokens/rotate", () => ({ token: `va_mock_${Date.now()}`, token_id: a.nextId("tok") }));
  r.on("GET", "/tasks", () => [...a.tasks.values()]);
  r.on("GET", "/tasks/:id", ({ params }) => a.tasks.get(params.id) ?? fail(404, "not_found", "Aufgabe unbekannt."));
  r.on("POST", "/tasks/:id/cancel", () => undefined);
}
