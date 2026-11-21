import { connect } from "./cdp.mjs";

const PORT = Number(process.env.BENCH_PORT || 9377);
const WRAP = process.env.BENCH_WRAPPER;
const FABRIC_MODS = (process.env.BENCH_MODS || "").split(",").filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = await connect(PORT);

async function waitTask(id) {
  for (;;) {
    const t = (await c.invoke("tasks_list")).find((x) => x.id === id);
    if (t && !["running", "queued"].includes(t.status)) return t;
    await sleep(250);
  }
}

const s = await c.invoke("settings_get");
s.wrapper_command = WRAP || null;
s.max_memory_mb = 4096;
s.min_memory_mb = 512;
await c.invoke("settings_set", { settings: s });

const want = [
  { name: "bench-vanilla", mc_version: "1.21.11", loader: { kind: "vanilla", version: null } },
  { name: "bench-fabric", mc_version: "1.21.11", loader: { kind: "fabric", version: null } },
  { name: "bench-neoforge", mc_version: "1.21.1", loader: { kind: "neoforge", version: null } },
];
const have = await c.invoke("instances_list");
for (const w of want) {
  let inst = have.find((i) => i.name === w.name);
  if (!inst) inst = await c.invoke("instance_create", { req: { ...w, icon: null, accent: null, group: null } });
  const t0 = Date.now();
  const t = await waitTask(await c.invoke("instance_install", { id: inst.id, force: false }));
  console.log(JSON.stringify({ name: w.name, id: inst.id, install: t.status, error: t.error, ms: Date.now() - t0 }));
  if (w.name === "bench-fabric") {
    for (const pid of FABRIC_MODS) {
      try {
        const tid = await c.invoke("content_install", { instanceId: inst.id, source: "modrinth", projectId: pid, versionId: null, expectManual: false });
        const r = await waitTask(tid);
        console.log(JSON.stringify({ mod: pid, status: r.status, error: r.error }));
      } catch (e) {
        console.log(JSON.stringify({ mod: pid, error: String(e).slice(0, 300) }));
      }
    }
  }
}
c.close();
process.exit(0);
