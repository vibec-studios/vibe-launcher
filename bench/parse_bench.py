import json, re, sys, statistics
log, results, prefix = sys.argv[1], sys.argv[2], sys.argv[3]
rx = re.compile(r"BENCH (\S+) (\d+)us")
segs, cur = [], {}
for line in open(log, encoding="utf-8", errors="replace"):
    m = rx.search(line)
    if not m:
        continue
    k, v = m.group(1), int(m.group(2)) / 1000
    cur[k] = cur.get(k, 0) + v
    if k == "launch_fn_total":
        segs.append(cur); cur = {}
res = [json.loads(l) for l in open(results, encoding="utf-8") if l.strip()]
res = [r for r in res if r["label"].startswith(prefix)]
segs = segs[-len(res):]
by = {}
for r, s in zip(res, segs):
    s["ui.total_to_spawn"] = r["spawn_ms"]; s["ui.task_done"] = r["task_done_ms"]
    by.setdefault(r["id"], []).append((r["label"], s))
keys = []
for v in by.values():
    for _, s in v:
        for k in s:
            if k not in keys: keys.append(k)
for inst, runs in by.items():
    print("##", inst, [l for l, _ in runs])
    for k in keys:
        vals = [s.get(k) for _, s in runs]
        if all(x is None for x in vals): continue
        warm = [x for x in vals[1:] if x is not None]
        med = statistics.median(warm) if warm else None
        print(f"{k:34s} cold={vals[0] if vals[0] is not None else '-':>8} warm_med={med if med is None else round(med,1):>8}  all={[None if x is None else round(x,1) for x in vals]}")
