from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path.cwd()
DATA_DIR = ROOT / "data"


def find_latest_root() -> Path:
    for path in ROOT.iterdir():
        if path.is_dir() and path.name.startswith("2026"):
            return path
    raise FileNotFoundError("Could not find the 2026 latest-data folder.")


def first_match(root: Path, filename: str) -> Path:
    matches = list(root.rglob(filename))
    if not matches:
        raise FileNotFoundError(filename)
    return matches[0]


def clean_text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def to_number(value: Any) -> int:
    text = clean_text(value)
    if not text:
        return 0
    text = "".join(char for char in text if char.isdigit() or char in ".-")
    if not text or text in {".", "-", "-."}:
        return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def track_from(value: Any) -> str:
    text = clean_text(value)
    if "物理" in text or "理科" in text or "理工" in text:
        return "physical"
    if "历史" in text or "文科" in text or "文史" in text:
        return "history"
    return ""


def compact_record(record: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in record.items() if value not in ("", 0, None)}


def build_group_rows(path: Path) -> list[dict[str, Any]]:
    df = pd.read_excel(path, sheet_name="Sheet1", dtype=object)
    rows: list[dict[str, Any]] = []
    for index, row in df.iterrows():
        if clean_text(row.iloc[0]) != "2025":
            continue
        track = track_from(row.iloc[3])
        if not track:
            continue
        min_score = to_number(row.iloc[9])
        min_rank = to_number(row.iloc[10])
        if not min_score and not min_rank:
            continue
        rows.append(
            compact_record(
                {
                    "id": f"admission-2025-{index}",
                    "year": 2025,
                    "school": clean_text(row.iloc[1]),
                    "schoolCode": clean_text(row.iloc[2]),
                    "track": track,
                    "batch": clean_text(row.iloc[4]),
                    "admissionType": clean_text(row.iloc[5]),
                    "group": clean_text(row.iloc[6]),
                    "subjectReq": clean_text(row.iloc[7]),
                    "plan": to_number(row.iloc[8]),
                    "countLabel": "录取数",
                    "minScore": min_score,
                    "minRank": min_rank,
                    "city": clean_text(row.iloc[12]),
                    "schoolType": clean_text(row.iloc[13]),
                    "tags": " ".join(
                        tag
                        for tag, flag in (
                            ("985", clean_text(row.iloc[14])),
                            ("211", clean_text(row.iloc[15])),
                        )
                        if flag == "是"
                    ),
                    "source": path.name,
                    "dataType": "2025 院校专业组录取线",
                }
            )
        )
    return rows


def build_major_rows(path: Path) -> list[dict[str, Any]]:
    df = pd.read_excel(path, sheet_name="Sheet1", dtype=object)
    rows: list[dict[str, Any]] = []
    for index, row in df.iterrows():
        if clean_text(row.iloc[0]) != "2025":
            continue
        track = track_from(row.iloc[3])
        if not track:
            continue
        min_score = to_number(row.iloc[11])
        min_rank = to_number(row.iloc[12])
        if not min_score and not min_rank:
            continue
        rows.append(
            compact_record(
                {
                    "id": f"major-2025-{index}",
                    "year": 2025,
                    "school": clean_text(row.iloc[1]),
                    "schoolCode": clean_text(row.iloc[2]),
                    "track": track,
                    "batch": clean_text(row.iloc[4]),
                    "major": clean_text(row.iloc[5]),
                    "majorCode": clean_text(row.iloc[6]),
                    "group": clean_text(row.iloc[7]),
                    "note": clean_text(row.iloc[8]),
                    "subjectReq": clean_text(row.iloc[9]),
                    "plan": to_number(row.iloc[10]),
                    "countLabel": "录取数",
                    "minScore": min_score,
                    "minRank": min_rank,
                    "city": clean_text(row.iloc[13]),
                    "schoolType": clean_text(row.iloc[14]),
                    "tags": " ".join(
                        tag
                        for tag, flag in (
                            ("985", clean_text(row.iloc[15])),
                            ("211", clean_text(row.iloc[16])),
                        )
                        if flag == "是"
                    ),
                    "source": path.name,
                    "dataType": "2025 专业录取线",
                }
            )
        )
    return rows


def write_js(path: Path, variable: str, rows: list[dict[str, Any]]) -> None:
    text = f"window.{variable} = "
    text += json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    text += ";\n"
    path.write_text(text, encoding="utf-8")


def main() -> None:
    latest_root = find_latest_root()
    group_path = first_match(latest_root, "22-25年全国高校在陕西的院校录取分数.xlsx")
    major_path = first_match(latest_root, "22-25年全国高校在陕西的专业录取分数.xlsx")
    group_rows = build_group_rows(group_path)
    major_rows = build_major_rows(major_path)
    DATA_DIR.mkdir(exist_ok=True)
    write_js(DATA_DIR / "admission-2025.js", "SX_ADMISSIONS_2025", group_rows)
    write_js(DATA_DIR / "major-2025.js", "SX_MAJOR_ADMISSIONS_2025", major_rows)
    print(f"group rows: {len(group_rows)}")
    print(f"major rows: {len(major_rows)}")


if __name__ == "__main__":
    main()
