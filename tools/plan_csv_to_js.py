import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_csv(path):
    with Path(path).open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main():
    inputs = [
        ROOT / "output" / "2026_history_plan.csv",
        ROOT / "output" / "2026_physical_plan.csv",
    ]
    rows = []
    for path in inputs:
        if path.exists():
            for row in read_csv(path):
                plan = int(row.get("计划数") or 0)
                major = row.get("专业", "")
                if plan <= 0 or "院校地址" in major:
                    continue
                rows.append({
                    "year": row.get("年份", "2026"),
                    "batch": row.get("批次", ""),
                    "track": row.get("首选科目", ""),
                    "schoolCode": row.get("院校代码", ""),
                    "school": row.get("院校名称", ""),
                    "group": row.get("院校专业组", ""),
                    "major": major,
                    "subject": row.get("再选科目", ""),
                    "plan": plan,
                    "source": row.get("来源", ""),
                    "majorCode": row.get("专业代码", ""),
                    "tuition": row.get("学费", ""),
                    "note": row.get("备注", ""),
                })
    out = ROOT / "data" / "plan-2026.js"
    out.write_text("window.SX_2026_PLANS = " + json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"wrote {out} rows={len(rows)}")


if __name__ == "__main__":
    main()
