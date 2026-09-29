from __future__ import annotations

from io import BytesIO
from zipfile import BadZipFile, ZipFile
from xml.etree import ElementTree

from app.ingestion.base import clean
from app.processing.pdf_extract import extract_pdf


def extract_document(data: bytes, max_chars: int = 1_000_000) -> tuple[str | None, str]:
    if data.startswith(b"%PDF"):
        return extract_pdf(data, max_chars=max_chars)
    if not data.startswith(b"PK"):
        return None, "unsupported_format"
    try:
        with ZipFile(BytesIO(data)) as archive:
            info = archive.getinfo("word/document.xml")
            if info.file_size > 30_000_000:
                return None, "too_large_to_extract"
            root = ElementTree.fromstring(archive.read(info))
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        paragraphs = []
        size = 0
        for paragraph in root.findall(".//w:p", ns):
            line = clean("".join(node.text or "" for node in paragraph.findall(".//w:t", ns)))
            if not line:
                continue
            paragraphs.append(line)
            size += len(line) + 1
            if size > max_chars:
                return "\n".join(paragraphs)[:max_chars], "text_truncated"
        text = "\n".join(paragraphs)
        return (text, "text_extracted") if len(text) >= 30 else (None, "no_text_layer")
    except (BadZipFile, KeyError, ElementTree.ParseError, ValueError):
        return None, "parse_error"
