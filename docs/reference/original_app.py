import os
import secrets
import tempfile
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse
from paddleocr import PaddleOCR, TextRecognition
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# 禁用 paddlex 模型源检查（避免每次启动都联网检查）
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

# --- 安全常量 ---
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_MAGIC: dict[str, bytes] = {
    "jpeg": b"\xff\xd8\xff",
    "png":  b"\x89\x50\x4e\x47",
    "bmp":  b"\x42\x4d",
    "webp": b"\x52\x49\x46\x46",
}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

ocr_engine: Optional[PaddleOCR] = None
rec_engine: Optional[TextRecognition] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global ocr_engine, rec_engine
    logger.info("初始化 PaddleOCR 引擎（首次运行需编译 kernel，约 2~5 分钟）...")
    ocr_engine = PaddleOCR()
    rec_engine = TextRecognition()
    logger.info("OCR 引擎加载完成")
    yield
    ocr_engine = None
    rec_engine = None


app = FastAPI(title="PaddleOCR Server", version="2.0.0", lifespan=lifespan)


# -------- 安全校验 --------

def _validate_magic(data: bytes) -> bool:
    for fmt, magic in ALLOWED_MAGIC.items():
        if data[: len(magic)] == magic:
            if fmt == "webp":
                return len(data) >= 12 and data[8:12] == b"WEBP"
            return True
    return False


def _validate_extension(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def _random_tmp_path() -> str:
    return os.path.join(tempfile.gettempdir(), f"ocr_{secrets.token_hex(16)}.png")


# -------- 验证码专用：自动分段识别 --------

def _recognize_captcha(img: Image.Image) -> list[dict]:
    """
    针对小图验证码（宽<100px）：
    1. 按像素行扫描，找连续有内容的行块
    2. 每块单独送入识别模型（跳过检测步骤，避免小图漏检）
    """
    arr = np.array(img.convert("RGB"))
    row_dark = np.any(arr < 200, axis=(1, 2))

    # 合并连续内容行，间隔 <=2 行的算同一块
    blocks = []
    in_block = False
    start = 0
    for y in range(len(row_dark)):
        if row_dark[y] and not in_block:
            start = y
            in_block = True
        elif not row_dark[y] and in_block:
            # 小间隔（<=2行）合并到上一块
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
        if seg_h < 3:   # 忽略太细的线（分隔线等噪声）
            continue
        line_img = img.crop((0, top, w, bottom))
        # 放大到合适识别大小
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


# -------- 通用识别 --------

def _recognize_general(tmp_path: str) -> list[dict]:
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


# -------- 接口 --------

@app.get("/health")
def health():
    return {"status": "ok", "engine_ready": ocr_engine is not None}


@app.post("/ocr/recognize")
async def recognize(
    file: UploadFile = File(..., description="待识别图片，支持 JPEG/PNG/BMP/WebP，最大 10 MB"),
    captcha_mode: bool = Form(default=False, description="验证码模式：自动分段识别小图"),
    return_confidence: bool = Form(default=False, description="是否返回置信度详情"),
):
    """
    上传图片，返回 OCR 识别结果。

    - `captcha_mode=true`：适合验证码小图，跳过检测步骤，按行分段识别
    - `captcha_mode=false`（默认）：通用文档/图片识别

    返回格式：
    ```json
    {
        "code": 0, "message": "success",
        "data": {
            "lines": ["识别文本1", "识别文本2"],
            "full_text": "识别文本1识别文本2",
            "details": [{"text": "...", "confidence": 0.99}]
        }
    }
    ```
    """
    if ocr_engine is None:
        raise HTTPException(status_code=503, detail="OCR 引擎未就绪")

    # 1. 大小限制
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"文件超过 {MAX_UPLOAD_BYTES // 1024 // 1024} MB 限制")

    # 2. 魔数校验
    if not _validate_magic(content):
        raise HTTPException(status_code=415, detail="不支持的文件类型，仅允许 JPEG/PNG/BMP/WebP")

    # 3. 扩展名白名单
    filename = file.filename or "upload"
    if not _validate_extension(filename):
        raise HTTPException(status_code=415, detail=f"扩展名不在白名单: {ALLOWED_EXTENSIONS}")

    # 4. 随机临时路径
    tmp_path = _random_tmp_path()
    try:
        with open(tmp_path, "wb") as f:
            f.write(content)

        img = Image.open(tmp_path).convert("RGB")
        w, h = img.size

        # 小图（宽或高 < 100px）自动切换验证码模式
        auto_captcha = w < 100 or h < 100
        use_captcha = captcha_mode or auto_captcha

        if use_captcha:
            items = _recognize_captcha(img)
        else:
            items = _recognize_general(tmp_path)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("OCR 处理异常: %s", e)
        raise HTTPException(status_code=500, detail="OCR 处理失败，请检查图片是否损坏")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    lines = [item["text"] for item in items]
    # 验证码模式用 "/" 分隔各行，通用模式用换行
    separator = "/" if use_captcha else "\n"
    resp_data: dict = {
        "lines": lines,
        "full_text": separator.join(lines),
        "captcha_mode_used": use_captcha,
    }
    if return_confidence:
        resp_data["details"] = items

    return JSONResponse({"code": 0, "message": "success", "data": resp_data})
