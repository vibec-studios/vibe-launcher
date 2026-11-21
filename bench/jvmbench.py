import ctypes, ctypes.wintypes as wt, json, os, re, subprocess, sys, threading, time

MARKERS = [
    ("loading", re.compile(r"Loading Minecraft|ModLauncher running|Loading \d+ mods|Fabric Loader \d")),
    ("user", re.compile(r"Setting user:")),
    ("window", re.compile(r"Backend library: LWJGL")),
    ("reload", re.compile(r"Reloading ResourceManager")),
    ("sound", re.compile(r"Sound engine started")),
    ("atlas", re.compile(r"Created: \d+x\d+x\d+ \S+-atlas")),
]
QUIET_S = 6.0

user32 = ctypes.windll.user32
EnumWindows = user32.EnumWindows
EnumProc = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)


def windows_of(pid):
    out = []

    def cb(hwnd, _):
        p = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value == pid and user32.IsWindowVisible(hwnd):
            out.append(hwnd)
        return True

    EnumWindows(EnumProc(cb), 0)
    return out


def close_gracefully(proc, timeout=90):
    for hwnd in windows_of(proc.pid):
        user32.PostMessageW(hwnd, 0x0010, 0, 0)
    try:
        proc.wait(timeout)
        return "closed"
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        return "killed"


def defender_sampler():
    return subprocess.Popen(["typeperf", r"\Prozess(MsMpEng)\Prozessorzeit (%)", "-si", "1"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            creationflags=0x08000000)


def defender_cpu_s(sampler):
    sampler.kill()
    out = sampler.communicate()[0].decode("cp850", "replace").splitlines()
    vals = []
    for l in out:
        parts = l.strip().split('","')
        if len(parts) == 2:
            try:
                vals.append(float(parts[1].strip('"').replace(",", ".")))
            except ValueError:
                pass
    return round(sum(vals) / 100.0, 2)


def wait_no_minecraft():
    script = os.environ.get("BENCH_MC_CHECK")
    if not script:
        return 0
    waited = 0
    while subprocess.call(["powershell", "-NoProfile", "-File", script], creationflags=0x08000000) != 0:
        time.sleep(30)
        waited += 30
    return waited


def run_once(argv, cwd, env, log_path):
    waited = wait_no_minecraft()
    samp = defender_sampler()
    t0 = time.perf_counter()
    proc = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            creationflags=0x08000000)
    hits = {}
    last_atlas = [None]
    lines = []

    def reader():
        for raw in proc.stdout:
            t = time.perf_counter() - t0
            line = raw.decode("utf-8", "replace")
            lines.append("%.3f %s" % (t, line.rstrip()))
            if "first" not in hits:
                hits["first"] = t
            for name, rx in MARKERS:
                if rx.search(line):
                    hits.setdefault(name, t)
                    if name == "atlas":
                        last_atlas[0] = t

    th = threading.Thread(target=reader, daemon=True)
    th.start()
    deadline = time.perf_counter() + 600
    outcome = "timeout"
    while time.perf_counter() < deadline:
        if proc.poll() is not None:
            outcome = "exited:%s" % proc.returncode
            break
        la = last_atlas[0]
        if la is not None and (time.perf_counter() - t0) - la > QUIET_S:
            outcome = "ready"
            break
        time.sleep(0.1)
    t_close0 = time.perf_counter()
    how = close_gracefully(proc) if proc.poll() is None else "already"
    t_exit = time.perf_counter() - t_close0
    th.join(5)
    mp_cpu = defender_cpu_s(samp)
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return {"outcome": outcome, "close": how, "shutdown_s": round(t_exit, 2), "msmpeng_cpu_s": mp_cpu, "waited_s": waited, "ready_s": round(last_atlas[0], 3) if last_atlas[0] else None,
            **{k: round(v, 3) for k, v in hits.items()}}


def main():
    a = sys.argv[1:]
    spawn, label, runs = a[0], a[1], int(a[2])
    opts, java, cwd, rest = [], None, None, a[3:]
    pre_cmds = []
    i = 0
    while i < len(rest):
        if rest[i] == "--opt":
            opts.append(rest[i + 1]); i += 2
        elif rest[i] == "--java":
            java = rest[i + 1]; i += 2
        elif rest[i] == "--cwd":
            cwd = rest[i + 1]; i += 2
        elif rest[i] == "--rm-before-first":
            pre_cmds.append(rest[i + 1]); i += 2
        else:
            raise SystemExit("unbekannt: " + rest[i])
    rec = json.load(open(spawn, encoding="utf-8"))
    argv = list(rec["argv"])
    if java:
        argv[0] = java
    cwd = cwd or rec["cwd"]
    argv = [argv[0]] + opts + argv[1:]
    out_dir = os.path.join(os.path.dirname(os.path.abspath(spawn)), "jvm")
    os.makedirs(out_dir, exist_ok=True)
    for p in pre_cmds:
        if os.path.exists(p):
            os.chmod(p, 0o666)
            os.remove(p)
    env = dict(os.environ)
    for r in range(runs):
        stamp = time.strftime("%H%M%S")
        res = run_once(argv, cwd, env, os.path.join(out_dir, "%s-%d-%s.log" % (label, r, stamp)))
        res.update({"label": label, "run": r, "opts": opts, "time": stamp})
        for o in opts:
            if o.startswith("-XX:SharedArchiveFile=") or o.startswith("-XX:AOTCache"):
                p = o.split("=", 1)[1]
                res["archive_bytes"] = os.path.getsize(p) if os.path.exists(p) else 0
        print(json.dumps(res), flush=True)
        with open(os.path.join(out_dir, "results.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(res) + "\n")
        time.sleep(3)


if __name__ == "__main__":
    main()
