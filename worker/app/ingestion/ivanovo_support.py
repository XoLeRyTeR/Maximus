from __future__ import annotations

import hashlib
import logging
from dataclasses import replace

from bs4 import BeautifulSoup

from .base import Document, Fetcher, Measure, absolute, clean
from app.processing.document_extract import extract_document

URL = "https://apk.ivanovoobl.ru/deyatelnost/gosudarstvennaya-podderzhka-/"
LOG = logging.getLogger(__name__)


def parse(html: str) -> list[Measure]:
    soup = BeautifulSoup(html, "html.parser")
    table = next((table for table in soup.select("table") if "Виды государственной поддержки" in table.get_text(" ", strip=True)), None)
    if table is None:
        raise ValueError("Ivanovo support table was not found")
    measures = []
    duplicate_titles: dict[str, int] = {}
    for row in table.select("tr")[1:]:
        cells = row.find_all("td", recursive=False)
        if len(cells) < 2:
            continue
        title = clean(cells[0].get_text(" ", strip=True))
        if not title:
            continue
        key = hashlib.sha256(title.lower().encode("utf-8")).hexdigest()[:20]
        duplicate_titles[key] = duplicate_titles.get(key, 0) + 1
        legal_text = clean(cells[1].get_text(" ", strip=True))
        documents = tuple(
            Document(url=absolute(URL, link["href"]), title=clean(link.get_text(" ", strip=True)) or "Нормативный акт")
            for link in cells[1].select("a[href]")
            if link["href"].startswith(("https://", "/"))
        )
        measures.append(Measure(
            source="ivanovo_official_support", source_url=URL,
            external_id=f"title:{key}:{duplicate_titles[key]}",
            title=title[:1000], region="Ивановская область", kind="measure",
            description=title[:12000], terms=legal_text[:20000], documents=documents,
        ))
    if not measures:
        raise ValueError("Ivanovo support table contained no measures")
    return measures


def collect(fetcher: Fetcher, max_documents: int = 100) -> list[Measure]:
    measures = parse(fetcher.html(URL))
    cache: dict[str, Document] = {}
    fetched = 0
    result = []
    for measure in measures:
        documents = []
        for document in measure.documents:
            if document.url not in cache:
                if fetched >= max_documents:
                    cache[document.url] = document
                else:
                    fetched += 1
                    try:
                        data, _ = fetcher.get(document.url)
                        text, status = extract_document(data)
                        cache[document.url] = replace(document, text=text, extraction_status=status)
                    except Exception as exc:
                        LOG.warning("Could not fetch support document %s: %s", document.url, type(exc).__name__)
                        cache[document.url] = replace(document, extraction_status="fetch_error")
            saved = cache[document.url]
            documents.append(replace(saved, title=document.title))
        result.append(replace(measure, documents=tuple(documents)))
    return result
