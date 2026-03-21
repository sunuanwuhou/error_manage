import os
from pathlib import Path

from paddleocr import PaddleOCR


def resolve_image_dir() -> str:
    env_dir = os.environ.get("OCR_IMAGE_DIR")
    if env_dir:
        return env_dir

    candidates = [
        Path.cwd() / ".runtime" / "ocr-34",
        Path(__file__).resolve().parent.parent / ".runtime" / "ocr-34",
        Path("/workspace/.runtime/ocr-34"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    return str(candidates[0])


def main() -> None:
    root = resolve_image_dir()
    ocr = PaddleOCR(
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        lang="ch",
    )

    for name in sorted(os.listdir(root)):
        if not name.endswith(".png"):
            continue
        path = os.path.join(root, name)
        result = ocr.predict(path)
        texts = []
        for item in result:
            if isinstance(item, dict):
                texts.extend(item.get("rec_texts", []))
        print(f"{name}: {' | '.join(texts)}")


if __name__ == "__main__":
    main()
