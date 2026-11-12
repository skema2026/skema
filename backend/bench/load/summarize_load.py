"""run_load.sh 결과(Locust CSV)를 단계별 표로 요약하고 <OUT>/summary.json 저장.

    python summarize_load.py run
"""
import csv, json, glob, os, sys
out = sys.argv[1] if len(sys.argv) > 1 else "run"
rows = []
ORDER = {"use": 0, "max": 1, "login": 2}


def key(p):
    kind, u = os.path.basename(p).replace("_stats.csv", "").rsplit("_u", 1)
    return (ORDER[kind], int(u))


def ours(p):  # run_load.sh가 만든 이름(use_u100 등)만
    b = os.path.basename(p).replace("_stats.csv", "")
    return "_u" in b and b.rsplit("_u", 1)[0] in ORDER and b.rsplit("_u", 1)[1].isdigit()


for f in sorted(filter(ours, glob.glob(f"{out}/*_stats.csv")), key=key):
    name = os.path.basename(f).replace("_stats.csv", "")
    with open(f) as fh:
        data = list(csv.DictReader(fh))
    agg = next(r for r in data if r["Name"] == "Aggregated")
    per = {r["Name"]: r for r in data if r["Name"] != "Aggregated"}
    n = int(agg["Request Count"]); fail = int(agg["Failure Count"])
    rows.append({
        "run": name, "requests": n, "fail": fail, "fail_rate": round(fail / n, 4) if n else 0,
        "rps": round(float(agg["Requests/s"]), 1),
        "p50": agg["50%"], "p95": agg["95%"], "p99": agg["99%"], "max": round(float(agg["Max Response Time"])),
        "dash_p95": per.get("GET /schedules", {}).get("95%"),
        "resched_p95": per.get("POST /reschedule/preview", {}).get("95%"),
        "gen_p95": per.get("POST /study-blocks/generate", {}).get("95%"),
        "login_p50": per.get("POST /auth/login", {}).get("50%"),
    })
print(f"{'run':12s} {'요청':>6s} {'실패율':>6s} {'초당':>6s} {'p50':>5s} {'p95':>6s} {'p99':>6s} {'최대':>6s} {'일정p95':>7s} {'다시짜기p95':>9s} {'배치p95':>7s} {'로그인p50':>8s}")
for r in rows:
    print(f"{r['run']:12s} {r['requests']:6d} {r['fail_rate']*100:5.2f}% {r['rps']:6.1f} {r['p50']:>5s} {r['p95']:>6s} {r['p99']:>6s} {r['max']:6d} {str(r['dash_p95']):>7s} {str(r['resched_p95']):>9s} {str(r['gen_p95']):>7s} {str(r['login_p50']):>8s}")
json.dump(rows, open(f"{out}/summary.json", "w"), ensure_ascii=False, indent=1)
