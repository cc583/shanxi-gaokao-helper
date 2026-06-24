import csv
from collections import Counter
from pathlib import Path


for path in [Path("output/2026_history_plan.csv"), Path("output/2026_physical_plan.csv")]:
    rows = list(csv.DictReader(path.open(encoding="utf-8-sig")))
    schools = {r["院校名称"] for r in rows if r["院校名称"]}
    empty_school = sum(1 for r in rows if not r["院校名称"])
    empty_group = sum(1 for r in rows if not r["院校专业组"])
    plan_sum = sum(int(r["计划数"] or 0) for r in rows)
    batches = Counter(r["批次"] for r in rows)
    print(path.name, "rows", len(rows), "schools", len(schools), "empty_school", empty_school, "empty_group", empty_group, "plan_sum", plan_sum, "batches", dict(batches))
    for row in rows[:5]:
        print(" ", row["院校代码"], row["院校名称"], row["院校专业组"], row["专业"], row["计划数"])

    suspicious = [
        r for r in rows
        if "院校地址" in r["专业"]
        or len(r["专业"]) > 80
        or not r["院校代码"]
        or not r["院校名称"]
        or not r["专业代码"]
    ]
    print(" suspicious", len(suspicious))
    for row in suspicious[:20]:
        print("  suspicious:", row["院校代码"], row["院校名称"], row["院校专业组"], row["专业代码"], row["专业"], row["计划数"])
