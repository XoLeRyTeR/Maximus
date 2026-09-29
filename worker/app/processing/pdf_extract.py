from __future__ import annotations

from io import BytesIO
import logging

from pypdf import PdfReader

from app.ingestion.base import clean

logging.getLogger("pypdf").setLevel(logging.ERROR)


def extract_pdf(data: bytes, max_chars: int = 1_000_000) -> tuple[str | None, str]:
    if not data.startswith(b"%PDF"):
        return None, "not_pdf"
    try:
        reader = PdfReader(BytesIO(data), strict=False)
        pages = []
        size = 0
        truncated = False
        for number, page in enumerate(reader.pages, 1):
            page_text = f"[Страница {number}] " + clean(page.extract_text() or "")
            if size + len(page_text) > max_chars:
                pages.append(page_text[:max_chars - size])
                truncated = True
                break
            pages.append(page_text)
            size += len(page_text)
        text = "\n".join(pages)
        if len(text) < 30:
            return None, "no_text_layer"
        return text, "text_truncated" if truncated else "text_extracted"
    except Exception:
        return None, "parse_error"
