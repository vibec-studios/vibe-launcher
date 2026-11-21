import json, os, sys, time

t0 = time.time_ns()
out_dir = os.environ.get("VIBE_BENCH_OUT") or os.path.dirname(os.path.abspath(__file__))
mode = os.environ.get("VIBE_BENCH_WRAP", "dump")
argv = sys.argv[1:]
rec = {"t_ns": t0, "cwd": os.getcwd(), "argv": argv, "mode": mode}
name = os.path.join(out_dir, "spawn-%d.json" % t0)
with open(name, "w", encoding="utf-8") as f:
    json.dump(rec, f)
if mode == "run":
    import subprocess
    sys.exit(subprocess.call(argv))
sys.exit(0)
