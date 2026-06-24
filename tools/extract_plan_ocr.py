import argparse
import csv
import json
import re
import subprocess
from pathlib import Path

from PIL import Image
from rapidocr_onnxruntime import RapidOCR


ROOT = Path(__file__).resolve().parents[1]
POPPLER = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe"


IGNORE_TEXTS = {
    "历", "史类", "物", "理类", "本", "科提", "科", "提前", "前", "批", "次", "·", "本科", "本科批次",
}


def clean_text(text):
    text = str(text or "").strip()
    text = text.replace(" ", "")
    text = text.replace("［", "[").replace("］", "]")
    text = text.replace("(", "（").replace(")", "）")
    return text


def box_metrics(box):
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    return min(xs), min(ys), max(xs), max(ys), sum(xs) / 4, sum(ys) / 4


def render_page(pdf, page, out_png, dpi=200):
    out_png.parent.mkdir(parents=True, exist_ok=True)
    if out_png.exists():
        return
    prefix = out_png.with_suffix("")
    cmd = [
        str(POPPLER),
        "-f", str(page),
        "-l", str(page),
        "-singlefile",
        "-r", str(dpi),
        "-png",
        str(pdf),
        str(prefix),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ocr_page(ocr, image_path, cache_path):
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))
    result, _ = ocr(str(image_path))
    rows = []
    for item in result or []:
        x1, y1, x2, y2, cx, cy = box_metrics(item[0])
        rows.append({
            "text": clean_text(item[1]),
            "confidence": float(item[2]),
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
            "cx": cx,
            "cy": cy,
        })
    cache_path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return rows


def column_for(cx, width):
    usable_left = width * 0.07
    usable_right = width * 0.94
    col_width = (usable_right - usable_left) / 3
    if cx < usable_left or cx > usable_right:
        return None
    return max(0, min(2, int((cx - usable_left) / col_width)))


def ordered_lines(items, image_size):
    width, height = image_size
    cols = {0: [], 1: [], 2: []}
    for item in items:
        text = item["text"]
        if not text or text in IGNORE_TEXTS:
            continue
        if "重要提示" in text or "考生填报志愿" in text:
            continue
        if item["cy"] < height * 0.035 or item["cy"] > height * 0.955:
            continue
        col = column_for(item["cx"], width)
        if col is None:
            continue
        item["col"] = col
        cols[col].append(item)
    output = []
    for col in range(3):
        output.extend(sorted(cols[col], key=lambda r: (r["cy"], r["x1"])))
    return output


def parse_school(text):
    m = re.match(r"^(\d{4})([\u4e00-\u9fa5A-Za-z0-9（）·\-]+?)(\d+)$", text)
    if not m or "组" in text or "科目要求" in text:
        return None
    return {"school_code": m.group(1), "school": m.group(2), "school_plan": int(m.group(3))}


def parse_group(text):
    m = re.match(r"^([0-9A-Z]{3})([0-9A-Z]{3}组(?:（[^）]+）)?)(\d+)$", text)
    if not m:
        return None
    return {"group_code": m.group(1), "group": m.group(2), "group_plan": int(m.group(3))}


def parse_subject(text):
    if "科目要求" not in text:
        return None
    return text.split("：", 1)[-1] if "：" in text else text.split(":", 1)[-1]


def parse_fee(text):
    m = re.search(r"\[(\d{3,6})元/年\]", text)
    return int(m.group(1)) if m else None


def major_start(text):
    if parse_school(text) or parse_group(text) or parse_subject(text) or parse_fee(text):
        return None
    if text.startswith("院校地址"):
        return None
    if text.startswith("（") or text.startswith("《") or text.startswith("["):
        return None
    m = re.match(r"^([0-9A-Z]{2})(.+)$", text)
    return m


def complete_major(text):
    m = re.match(r"^([0-9A-Z]{2})(.+?)(\d+)$", text)
    if not m:
        return None
    name = m.group(2).strip("，,、 ")
    if not name or len(name) < 2:
        return None
    return {"major_code": normalize_code(m.group(1)), "major": name, "plan": int(m.group(3))}


def normalize_code(code):
    code = str(code or "").strip().upper()
    if len(code) >= 1 and code[0] in {"I", "L"}:
        code = "1" + code[1:]
    if len(code) >= 1 and code[0] == "O":
        code = "0" + code[1:]
    return code


def flush_pending_major(state, rows, track, batch, source, force=False):
    pending = state.get("pending_major")
    if not pending:
        return
    parsed = complete_major(pending["text"])
    if parsed or force:
        if not parsed:
            parsed = {"major_code": pending["code"], "major": pending["text"][2:], "plan": 0}
        rows.append({
            "年份": "2026",
            "批次": batch,
            "首选科目": track,
            "院校代码": state.get("school_code", ""),
            "院校名称": state.get("school", ""),
            "院校专业组": state.get("group", ""),
            "专业": parsed["major"],
            "再选科目": state.get("subject", ""),
            "计划数": parsed["plan"],
            "最低分": "",
            "最低位次": "",
            "城市": "",
            "来源": source,
            "专业代码": parsed["major_code"],
            "学费": "",
            "备注": "",
        })
        state["last_row"] = rows[-1]
        state["pending_major"] = None


def parse_lines(lines, state, rows, track, source):
    batch = state.get("batch", "本科")
    for item in lines:
        text = item["text"]
        if "本科提前批次" in text:
            state["batch"] = "本科提前批"
            batch = state["batch"]
            continue
        if "本科批次" in text:
            state["batch"] = "本科"
            batch = state["batch"]
            continue

        school = parse_school(text)
        if school:
            flush_pending_major(state, rows, track, batch, source, force=True)
            state.update(school)
            state["group"] = ""
            state["group_code"] = ""
            state["subject"] = ""
            continue

        group = parse_group(text)
        if group:
            flush_pending_major(state, rows, track, batch, source, force=True)
            state.update(group)
            state["subject"] = ""
            continue

        subject = parse_subject(text)
        if subject:
            state["subject"] = subject
            continue

        fee = parse_fee(text)
        if fee is not None:
            flush_pending_major(state, rows, track, batch, source)
            if state.get("last_row"):
                state["last_row"]["学费"] = fee
            continue

        start = major_start(text)
        if start:
            flush_pending_major(state, rows, track, batch, source, force=False)
            state["pending_major"] = {"code": start.group(1), "text": text}
            flush_pending_major(state, rows, track, batch, source, force=False)
            continue

        if state.get("pending_major"):
            state["pending_major"]["text"] += text
            flush_pending_major(state, rows, track, batch, source, force=False)
            continue

        if state.get("last_row") and (text.startswith("（") or text.startswith("《")):
            old = state["last_row"].get("备注", "")
            state["last_row"]["备注"] = (old + text)[:300]


def extract(pdf, track, start_page, end_page, out_csv, dpi=200):
    pdf = Path(pdf)
    source = f"{pdf.name}"
    out_csv = Path(out_csv)
    work = ROOT / "tmp" / "ocr_plan" / track
    image_dir = work / "images"
    cache_dir = work / "cache"
    ocr = RapidOCR()
    rows = []
    state = {"batch": "本科"}

    for page in range(start_page, end_page + 1):
        image_path = image_dir / f"page-{page:04d}.png"
        cache_path = cache_dir / f"page-{page:04d}.json"
        render_page(pdf, page, image_path, dpi=dpi)
        items = ocr_page(ocr, image_path, cache_path)
        image_size = Image.open(image_path).size
        lines = ordered_lines(items, image_size)
        parse_lines(lines, state, rows, track, source)
        if page == start_page or page == end_page or (page - start_page + 1) % 10 == 0:
            print(f"page {page}: rows={len(rows)}")

    flush_pending_major(state, rows, track, state.get("batch", "本科"), source, force=True)
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    fields = ["年份", "批次", "首选科目", "院校代码", "院校名称", "院校专业组", "专业", "再选科目", "计划数", "最低分", "最低位次", "城市", "来源", "专业代码", "学费", "备注"]
    with out_csv.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {out_csv} rows={len(rows)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--track", required=True, choices=["历史", "物理"])
    parser.add_argument("--start-page", type=int, default=29)
    parser.add_argument("--end-page", type=int, required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--dpi", type=int, default=200)
    args = parser.parse_args()
    extract(args.pdf, args.track, args.start_page, args.end_page, args.out, args.dpi)


if __name__ == "__main__":
    main()
