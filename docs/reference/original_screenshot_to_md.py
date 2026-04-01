#!/usr/bin/env python3
"""
screenshot_to_md.py
行测刷题 APP 截图 → 复制文本

用法：
  python3 screenshot_to_md.py img1.png img2.png ...
  python3 screenshot_to_md.py *.png -o result.txt
"""

import sys
import json
import argparse
import urllib.request
from pathlib import Path

OCR_URL = "http://localhost:8000/ocr/recognize"


def ocr_file(path: str) -> list[str]:
    """调用本地 OCR，返回文本行列表"""
    data = Path(path).read_bytes()
    filename = Path(path).name
    b = "----ScrBoundary"
    body = (
        f"--{b}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode() + data + (
        f"\r\n--{b}--\r\n"
    ).encode()
    req = urllib.request.Request(
        OCR_URL, data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={b}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.loads(r.read()).get("data", {})
            return d.get("lines", [])
    except Exception as e:
        print(f"  [OCR 失败] {e}", file=sys.stderr)
        return []


def main():
    ap = argparse.ArgumentParser(description="行测截图 → 文本")
    ap.add_argument("images", nargs="+", help="截图文件路径")
    ap.add_argument("-o", "--out", help="输出文件（默认打印到控制台）")
    args = ap.parse_args()

    blocks = []
    for i, path in enumerate(args.images, 1):
        if not Path(path).exists():
            print(f"❌ 不存在: {path}", file=sys.stderr)
            continue
        print(f"[{i}/{len(args.images)}] {Path(path).name}", file=sys.stderr)
        lines = ocr_file(path)
        blocks.append("\n".join(lines))

    output = "\n\n---\n\n".join(blocks)

    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"✅ 写入: {args.out}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
