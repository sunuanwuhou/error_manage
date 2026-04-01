#!/usr/bin/env python3
import json
import os
import secrets
import sys
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image, ImageEnhance
from paddleocr import PaddleOCR, TextRecognition

os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_MAGIC = {
    "jpeg": b"\xff\xd8\xff",
    "png": b"\x89\x50\x4e\x47",
    "bmp": b"\x42\x4d",
    "webp": b"\x52\x49\x46\x46",
}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

_ocr_engine: Optional[PaddleOCR] = None
_rec_engine: Optional[TextRecognition] = None

def get_ocr():
    global _ocr_engine, _rec_engine
    if _ocr_engine is None:
        _ocr_engine = PaddleOCR()
    if _rec_engine is None:
        _rec_engine = TextRecognition()
    return _ocr_engine, _rec_engine

def validate_magic(data: bytes) -> bool:
    for fmt, magic in ALLOWED_MAGIC.items():
        if data[: len(magic)] == magic:
            if fmt == "webp":
                return len(data) >= 12 and data[8:12] == b"WEBP"
            return True
    return False

def validate_extension(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS

def preprocess_image(tmp_path: str):
    img = Image.open(tmp_path).convert("RGB")
    w, h = img.size
    min_side = min(w, h)
    if min_side < 200:
        scale = max(2, 200 // max(min_side, 1))
        img = img.resize((img.width * scale, img.height * scale), Image.LANCZOS)
    img = ImageEnhance.Contrast(img).enhance(1.35)
    img.save(tmp_path)

def recognize_captcha(img: Image.Image) -> list[dict]:
    _, rec_engine = get_ocr()
    arr = np.array(img.convert("RGB"))
    row_dark = np.any(arr < 200, axis=(1, 2))
    blocks = []
    in_block = False
    start = 0
    for y in range(len(row_dark)):
        if row_dark[y] and not in_block:
            start = y
            in_block = True
        elif not row_dark[y] and in_block:
            if blocks and y - blocks[-1][1] <= 2:
                blocks[-1] = (blocks[-1][0], y)
            else:
                blocks.append((start, y))
            in_block = False
    if in_block:
        blocks.append((start, img.height))

    results = []
    w = img.width
    for top, bottom in blocks:
        seg_h = bottom - top
        if seg_h < 3:
            continue
        line_img = img.crop((0, top, w, bottom))
        scale = max(8, 32 // max(seg_h, 1))
        line_img = line_img.resize(
            (max(line_img.width * scale, 64), max(line_img.height * scale, 32)),
            Image.NEAREST,
        )
        preds = list(rec_engine.predict(np.array(line_img)))
        if preds:
            d = dict(preds[0])
            text = d.get("rec_text", "")
            score = float(d.get("rec_score", 0))
            if text:
                results.append({"text": text, "confidence": round(score, 4), "row": [top, bottom]})
    return results

def recognize_general(tmp_path: str) -> list[dict]:
    ocr_engine, _ = get_ocr()
    result = ocr_engine.predict(
        tmp_path,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    r = result[0].json["res"]
    texts = r.get("rec_texts", [])
    scores = r.get("rec_scores", [])
    polys = r.get("rec_polys", [])
    return [
        {"text": t, "confidence": round(float(s), 4), "box": p.tolist() if hasattr(p, "tolist") else p}
        for t, s, p in zip(texts, scores, polys)
    ]

def normalize_line(line: str) -> str:
    return (
        line.replace("Ａ", "A")
            .replace("Ｂ", "B")
            .replace("Ｃ", "C")
            .replace("Ｄ", "D")
            .strip()
    )

def parse_option_lines(lines: list[str]) -> list[str]:
    out = []
    for line in lines:
        line = normalize_line(line)
        if line[:1] in {"A", "B", "C", "D"} and len(line) > 1 and line[1] in {".", "、", ")", "）", ":", "："}:
            out.append(line[0] + "." + line[2:].strip())
    return out

def infer_type(full_text: str, options: list[str]) -> str:
    text = full_text or ""
    if "资料" in text or "同比" in text or "环比" in text or "表格" in text:
        return "资料分析"
    if "图形" in text or "立体图" in text or "平面图" in text:
        return "判断推理"
    if "填入划横线" in text or "文段" in text:
        return "言语理解"
    if len(options) == 2:
        raw = [o[2:].strip() if len(o) > 2 else o for o in options]
        if all(any(t in x for t in ["正确", "错误", "对", "错"]) for x in raw):
            return "判断题"
    return "单项选择题"

def extract_answer(text: str) -> str:
    import re
    hit = re.search(r'(?:正确答案|参考答案|答案)[:：]?\s*([A-D])', text, re.I)
    return hit.group(1).upper() if hit else ""

def extract_analysis(text: str) -> str:
    import re
    hit = re.search(r'(?:解析|答案解析)[:：]?\s*([\s\S]+)$', text)
    return hit.group(1).strip() if hit else ""

def recognize_file(path: str):
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError("文件不存在")
    data = file_path.read_bytes()
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("文件超过大小限制")
    if not validate_magic(data):
        raise ValueError("不支持的图片类型")
    if not validate_extension(file_path.name):
        raise ValueError("扩展名不支持")

    tmp_path = os.path.join(tempfile.gettempdir(), f"ocr_{secrets.token_hex(16)}{file_path.suffix.lower()}")
    try:
        with open(tmp_path, "wb") as f:
            f.write(data)

        preprocess_image(tmp_path)
        img = Image.open(tmp_path).convert("RGB")
        w, h = img.size
        use_captcha = w < 100 or h < 100
        items = recognize_captcha(img) if use_captcha else recognize_general(tmp_path)
        lines = [normalize_line(item["text"]) for item in items if item.get("text")]
        full_text = ("\n".join(lines)).strip()
        options = parse_option_lines(lines)
        content = ""
        for line in lines:
            first = line[:1]
            if first in {"A", "B", "C", "D"} and len(line) > 1 and line[1] in {".", "、", ")", "）", ":", "："}:
                continue
            content = line
            break

        return {
            "lines": lines,
            "full_text": full_text,
            "captcha_mode_used": use_captcha,
            "details": items,
            "content": content or full_text,
            "options": options,
            "answer": extract_answer(full_text),
            "analysis": extract_analysis(full_text),
            "type": infer_type(full_text, options),
        }
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "缺少图片路径"}, ensure_ascii=False))
        sys.exit(1)
    try:
        data = recognize_file(sys.argv[1])
        print(json.dumps({"ok": True, "data": data}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(2)

if __name__ == "__main__":
    main()
