from __future__ import annotations

import re
from dataclasses import replace
from datetime import date

from bs4 import BeautifulSoup

from app.processing.normalize import application_window, parse_date
from app.processing.pdf_extract import extract_pdf

from .base import Document, Fetcher, Measure, absolute, clean

URL = "https://apk.ivanovoobl.ru/deyatelnost/otbor-poluchateley-subsidiy/obyavleniya-o-provedenii-otbora-poluchateley-subsidiy/"
DATE_ONLY = re.compile(r"^\s*(\d{2}\.\d{2}\.20\d{2})\s*$")


def parse(html: str, year: int | None = None) -> list[Measure]:
    year = year or date.today().year
    soup = BeautifulSoup(html, "html.parser")
    body = soup.select_one(".Content__body")
    if body is None:
        raise ValueError("Ivanovo announcements body was not found")
    measures: list[Measure] = []
    published: date | None = None
    seen = set()
    for child in body.children:
        if getattr(child, "name", None) != "p":
            continue
        content = clean(child.get_text(" ", strip=True))
        match = DATE_ONLY.fullmatch(content)
        if match:
            published = parse_date(match.group(1))
            continue
        if not published or published.year != year:
            continue
        for link in child.select("a[href]"):
            title = clean(link.get_text(" ", strip=True))
            if len(title) < 35 or not any(word in title.lower() for word in ("субсиди", "грант", "отбор")):
                continue
            document_url = absolute(URL, link["href"])
            if document_url in seen or not document_url.startswith("https://apk.ivanovoobl.ru/"):
                continue
            seen.add(document_url)
            measures.append(Measure(
                source="ivanovo_official_selections", source_url=URL,
                external_id=document_url, title=title[:1000],
                region="Ивановская область", kind="selection",
                description=title[:12000], published_at=published,
                documents=(Document(url=document_url, title="Объявление об отборе"),),
            ))
    if not measures:
        raise ValueError(f"No Ivanovo selection announcements found for {year}")
    return measures


def collect(fetcher: Fetcher, max_pdfs: int = 50, year: int | None = None) -> list[Measure]:
    measures = parse(fetcher.html(URL), year=year)
    enriched = []
    for index, measure in enumerate(measures):
        if index >= max_pdfs:
            enriched.append(measure)
            continue
        document = measure.documents[0]
        if not document.url.lower().split("?", 1)[0].endswith(".pdf"):
            enriched.append(measure)
            continue
        try:
            data, content_type = fetcher.get(document.url)
            text, status = extract_pdf(data) if ("pdf" in content_type.lower() or data.startswith(b"%PDF")) else (None, "not_pdf")
            start, deadline = application_window(text or "")
            enriched.append(replace(
                measure, description=(text or measure.description)[:120_000],
                application_start=start, application_deadline=deadline,
                documents=(replace(document, text=text, extraction_status=status),),
            ))
        except Exception:
            enriched.append(replace(measure, documents=(replace(document, extraction_status="fetch_error"),)))
    return enriched
