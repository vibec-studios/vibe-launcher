import { connect } from "./cdp.mjs";
const [id, list] = process.argv.slice(2);
const c = await connect(Number(process.env.BENCH_PORT || 9377));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const pid of list.split(",")) {
  try {
    const tid = await c.invoke("content_install", { instanceId: id, source: "modrinth", projectId: pid, versionId: null, expectManual: false });
    let t;
    do { await sleep(250); t = (await c.invoke("tasks_list")).find((x) => x.id === tid); } while (!t || ["running", "queued"].includes(t.status));
    console.log(JSON.stringify({ mod: pid, status: t.status, error: t.error }));
  } catch (e) { console.log(JSON.stringify({ mod: pid, error: String(e).slice(0, 300) })); }
}
c.close(); process.exit(0);
