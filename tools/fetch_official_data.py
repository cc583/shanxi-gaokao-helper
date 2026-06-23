import datetime as dt
import json
import re
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "official-data.js"
TODAY = dt.date.today().isoformat()


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8", "ignore")


def clean(value):
    value = re.sub(r"<[^>]+>", "", value)
    value = value.replace("&nbsp;", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def to_int(value):
    match = re.search(r"-?\d+", str(value).replace(",", ""))
    return int(match.group()) if match else 0


def parse_rows(html):
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.I | re.S)
    parsed = []
    for row in rows:
        cells = [clean(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", row, re.I | re.S)]
        if cells:
            parsed.append(cells)
    return parsed


def parse_segments(url, track):
    html = fetch(url)
    result = []
    for cells in parse_rows(html):
        if not cells:
            continue
        first = cells[0]
        if not re.match(r"^\d+", first):
            continue
        nums = [to_int(cell) for cell in cells[1:] if to_int(cell)]
        if len(nums) >= 2:
            count, cumulative = nums[0], nums[1]
        elif len(nums) == 1:
            count = cumulative = nums[0]
        else:
            continue
        result.append({
            "track": track,
            "score": to_int(first),
            "scoreText": first,
            "count": count,
            "cumulative": cumulative,
        })
    result.sort(key=lambda row: row["score"], reverse=True)
    return result


def parse_admissions(url, year, batch, source_title):
    html = fetch(url)
    result = []
    for cells in parse_rows(html):
        if len(cells) < 8 or not cells[0].strip().isdigit():
            continue
        result.append({
            "year": year,
            "batch": batch,
            "subject": cells[1].strip(),
            "schoolCode": cells[2].strip(),
            "school": cells[3].strip(),
            "plan": to_int(cells[4]),
            "filed": to_int(cells[5]),
            "minScore": to_int(cells[6]),
            "minRank": to_int(cells[7]),
            "sourceTitle": source_title,
            "sourceUrl": url,
        })
    return result


def main():
    sources = [
        {
            "title": "《2026年陕西省普通高等学校招生工作实施办法》政策解读50问",
            "url": "https://www.sneac.com/info/1020/18733.htm",
            "usedFor": "2026 年陕西新高考规则、志愿容量和填报口径提示",
            "accessed": TODAY,
        },
        {
            "title": "名词解释｜什么是平行志愿？",
            "url": "https://www.sneac.com/info/1003/18748.htm",
            "usedFor": "2026 年成绩和各批次录取控制分数线公布时间提示",
            "accessed": TODAY,
        },
        {
            "title": "陕西省2025年普通高等学校招生录取最低控制分数线",
            "url": "https://www.sneac.com/info/1019/18384.htm",
            "usedFor": "2025 年本科、特殊类型、高职专科批次线差",
            "accessed": TODAY,
        },
        {
            "title": "2025年陕西省普通高考一分段统计表（普通物理、艺术物理、体育物理）",
            "url": "https://www.sneac.com/info/1019/18391.htm",
            "usedFor": "物理类分数到位次估算",
            "accessed": TODAY,
        },
        {
            "title": "2025年陕西省普通高考一分段统计表（普通历史、艺术历史、体育历史）",
            "url": "https://www.sneac.com/info/1019/18393.htm",
            "usedFor": "历史类分数到位次估算",
            "accessed": TODAY,
        },
        {
            "title": "2024年陕西省普通高校招生本科一批录取正式投档",
            "url": "https://www.sneac.com/info/1374/18309.htm",
            "usedFor": "2024 年本科一批文史/理工官方投档历史参考",
            "accessed": TODAY,
        },
        {
            "title": "2024年陕西省普通高校招生本科二批录取正式投档",
            "url": "https://www.sneac.com/info/1374/18307.htm",
            "usedFor": "2024 年本科二批文史/理工官方投档历史参考",
            "accessed": TODAY,
        },
        {
            "title": "2024年陕西省普通高校招生高职（专科）批次录取正式投档",
            "url": "https://www.sneac.com/info/1374/18305.htm",
            "usedFor": "2024 年高职专科文史/理工官方投档历史参考",
            "accessed": TODAY,
        },
    ]

    segments = {
        "physical": parse_segments("https://www.sneac.com/info/1019/18391.htm", "physical"),
        "history": parse_segments("https://www.sneac.com/info/1019/18393.htm", "history"),
    }

    admission_sources = [
        ("https://www.sneac.com/htm/2024/1BZS-LG.html", 2024, "本科一批", "2024 本科一批理工正式投档表"),
        ("https://www.sneac.com/htm/2024/1BZS-WS.html", 2024, "本科一批", "2024 本科一批文史正式投档表"),
        ("https://www.sneac.com/htm/2024/2024EBZS-LG.html", 2024, "本科二批", "2024 本科二批理工正式投档表"),
        ("https://www.sneac.com/htm/2024/2024EBZS-WS.html", 2024, "本科二批", "2024 本科二批文史正式投档表"),
        ("https://www.sneac.com/htm/2024/2024GZZKZS-LG.html", 2024, "高职专科", "2024 高职专科理工正式投档表"),
        ("https://www.sneac.com/htm/2024/2024GZZKZS-WS.html", 2024, "高职专科", "2024 高职专科文史正式投档表"),
    ]

    admissions = []
    for args in admission_sources:
        admissions.extend(parse_admissions(*args))

    payload = {
        "generatedAt": TODAY,
        "rules": {
            "province": "陕西省",
            "examMode": "3+1+2",
            "undergraduateGeneralCapacity": 45,
            "note": "2026 年陕西普通本科批志愿以官方填报系统和招生计划为准；本程序用于辅助筛选。",
        },
        "controlLines": {
            "2025": {
                "history": {"undergraduate": 414, "special": 497, "vocational": 200},
                "physical": {"undergraduate": 394, "special": 473, "vocational": 200},
            }
        },
        "segments": segments,
        "admissions": admissions,
        "sources": sources,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("window.SX_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"wrote {OUT}")
    print(f"segments: physical={len(segments['physical'])}, history={len(segments['history'])}")
    print(f"admissions: {len(admissions)}")


if __name__ == "__main__":
    main()
