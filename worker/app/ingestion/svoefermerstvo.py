from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import replace
from datetime import datetime
from threading import local
from urllib.parse import urlencode

from bs4 import BeautifulSoup

from .base import Document, Fetcher, Measure, absolute, clean

URL = "https://svoefermerstvo.ru/mery-podderzhki"
LOG = logging.getLogger(__name__)

_DATE_RE = re.compile(r"(?<!\d)(\d{1,2}[./-]\d{1,2}[./-]\d{4})(?!\d)")
_APPLICATION_LABELS = (
    "срок приема заявок",
    "срок приёма заявок",
    "период приема заявок",
    "период приёма заявок",
    "прием заявок",
    "приём заявок",
    "подать заявку до",
)


def _after_label(text: str, label: str, stop_labels: tuple[str, ...]) -> str:
    """Return a card section without relying on generated CSS class names."""
    start = text.find(label)
    if start < 0:
        return ""
    start += len(label)
    end = len(text)
    for stop in stop_labels:
        position = text.find(stop, start)
        if 0 <= position < end:
            end = position
    return clean(text[start:end])


def _before_labels(text: str, labels: tuple[str, ...]) -> str:
    end = len(text)
    for label in labels:
        position = text.find(label)
        if 0 <= position < end:
            end = position
    value = clean(text[:end]).strip()
    return "" if value == "." else value


def _decode_js_string(value: str) -> str:
    return re.sub(
        r"\\u([0-9a-fA-F]{4})",
        lambda match: chr(int(match.group(1), 16)),
        value,
    ).replace(r"\/", "/")


def _parse_date(value: str):
    for fmt in ("%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    return None


def _application_dates(text: str):
    """Parse dates only near an explicit application-period label.

    Detail pages also contain publication dates and a term for spending the
    awarded money. Neither is an application deadline.
    """
    lowered = text.lower()
    for label in _APPLICATION_LABELS:
        offset = lowered.find(label)
        if offset < 0:
            continue
        dates = [_parse_date(value) for value in _DATE_RE.findall(text[offset:offset + 240])]
        dates = [value for value in dates if value is not None]
        if dates:
            return (dates[0] if len(dates) > 1 else None, dates[-1])
    return None, None


def _card_text(card, title: str) -> str:
    text = clean(card.get_text(" ", strip=True))
    if text.startswith(title):
        text = text[len(title):].strip()
    if text.endswith("Подробнее"):
        text = text[:-len("Подробнее")].strip()
    return text


def parse(html: str) -> list[Measure]:
    soup = BeautifulSoup(html, "html.parser")
    measures = []
    seen = set()
    for heading in soup.find_all("h2"):
        card = heading.find_parent("div", class_=lambda classes: classes and "color-2--gray-100-bg" in classes)
        if card is None:
            continue
        detail = next((a for a in card.select("a[href]") if "/mery-podderzhki/" in a["href"]), None)
        if detail is None:
            continue
        url = absolute(URL, detail["href"])
        if url in seen:
            continue
        seen.add(url)
        title = clean(heading.get_text(" ", strip=True))
        text = _card_text(card, title)
        description = _before_labels(text, ("Главные условия", "Размер", "Получатели"))
        terms = _after_label(text, "Главные условия", ("Размер", "Получатели"))
        recipients = _after_label(text, "Получатели", ())
        if recipients:
            terms = clean(f"{terms} Получатели: {recipients}")
        amount = _after_label(text, "Размер", ("Получатели",)) or None
        measures.append(Measure(
            source="svoefermerstvo_federal", source_url=url, external_id=url,
            title=title, region=None, kind="measure", description=description[:16000],
            terms=terms[:16000], amount=amount,
        ))
    if not measures:
        raise ValueError("Federal catalog contained no support cards")
    return measures


def parse_detail(html: str, measure: Measure) -> Measure:
    """Enrich a catalog card from its public detail page."""
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.find("h1")
    if heading is None:
        raise ValueError(f"Support detail contained no h1: {measure.source_url}")

    header = heading.find_parent("div", class_=lambda classes: classes and "custom-first-block" in classes)
    main = soup.find("main")
    if header is None or main is None:
        raise ValueError(f"Support detail layout is unknown: {measure.source_url}")

    header_text = clean(header.get_text(" ", strip=True))
    main_text = clean(main.get_text(" ", strip=True))

    description = measure.description
    summary_start = header_text.find(measure.title, len(measure.title))
    if summary_start >= 0:
        candidate = header_text[summary_start + len(measure.title):]
        candidate = _before_labels(candidate, ("Главные условия", "Размер", "Получатели"))
        if candidate:
            description = candidate

    detailed_parts = []
    for label in ("Возможности", "Условия получения", "Как получить поддержку"):
        value = _after_label(main_text, label, (
            "Возможности", "Условия получения", "Как получить поддержку",
            "Выберите регион получения поддержки", "Больше о господдержке",
        ))
        if value and value not in detailed_parts:
            detailed_parts.append(f"{label}: {value}")

    terms = measure.terms
    if detailed_parts:
        terms = clean(f"{terms} {' '.join(detailed_parts)}")

    regions = []
    for script in soup.find_all("script"):
        payload = script.string or ""
        if "mery_podderzhki_region" not in payload:
            continue
        regions.extend(re.findall(r'dict_item_name:"([^"]+?(?:области|края|округа|республики|Республика|Москва|Севастополь|Санкт-Петербург))"', payload))
    regions = list(dict.fromkeys(regions))
    region = ", ".join(regions) if regions else measure.region

    documents = []
    for link in main.select("a[href]"):
        label = clean(link.get_text(" ", strip=True))
        href = link.get("href", "")
        if label and any(word in label.lower() for word in ("документ", "постановление", "приказ")):
            documents.append(Document(url=absolute(measure.source_url, href), title=label))
    for script in soup.find_all("script"):
        payload = script.string or ""
        block = re.search(r"pravovie_normy:\[(.*?)\],mery_podderzhki_region", payload, re.S)
        if block is None:
            continue
        for title, url in re.findall(r'text:"([^"]+)",link:"([^"]+)"', block.group(1)):
            documents.append(Document(url=_decode_js_string(url), title=_decode_js_string(title)))
    documents = list({doc.url: doc for doc in documents}.values())

    application_start, application_deadline = _application_dates(main_text)
    return replace(
        measure,
        description=description[:16000],
        terms=terms[:50000],
        region=region,
        application_start=application_start,
        application_deadline=application_deadline,
        documents=tuple(documents),
    )


def collect(fetcher: Fetcher, max_pages: int = 200, detail_workers: int = 4) -> list[Measure]:
    html = fetcher.html(URL)
    first = parse(html)
    soup = BeautifulSoup(html, "html.parser")
    numbers = [int(a.get_text(" ", strip=True)) for a in soup.select(".theme-2-pagination--page") if a.get_text(" ", strip=True).isdigit()]
    total_pages = max(numbers, default=1)
    if total_pages > max_pages:
        raise ValueError(f"Federal catalog has {total_pages} pages, exceeding configured max_pages={max_pages}")
    measures = {m.external_id: m for m in first}
    page_state = local()

    def fetch_page(page: int):
        if not hasattr(page_state, "fetcher"):
            page_state.fetcher = Fetcher(timeout=fetcher.timeout, max_bytes=fetcher.max_bytes)
        page_url = f"{URL}?{urlencode({'page': page})}"
        error = None
        for attempt in range(3):
            try:
                return page, parse(page_state.fetcher.html(page_url))
            except Exception as exc:
                error = exc
                time.sleep(attempt + 1)
        raise error

    with ThreadPoolExecutor(max_workers=detail_workers) as pool:
        futures = [pool.submit(fetch_page, page) for page in range(2, total_pages + 1)]
        for completed, future in enumerate(as_completed(futures), start=1):
            page, page_measures = future.result()
            for measure in page_measures:
                measures[measure.external_id] = measure
            if completed % 20 == 0 or completed == len(futures):
                LOG.info("federal catalog pages %s/%s: %s unique measures", completed + 1, total_pages, len(measures))
    values = list(measures.values())
    result: list[Measure | None] = [None] * len(values)
    worker_state = local()

    def enrich(index: int, measure: Measure):
        if not hasattr(worker_state, "fetcher"):
            worker_state.fetcher = Fetcher(timeout=fetcher.timeout, max_bytes=fetcher.max_bytes)
        error = None
        for attempt in range(3):
            try:
                return index, parse_detail(worker_state.fetcher.html(measure.source_url), measure)
            except Exception as exc:
                error = exc
                time.sleep(attempt + 1)
        # Skip the update so a temporary source failure cannot replace a rich
        # stored detail with the much smaller listing card.
        LOG.warning("federal detail failed for %s after retries: %s", measure.source_url, error)
        return index, None

    with ThreadPoolExecutor(max_workers=detail_workers) as pool:
        futures = [pool.submit(enrich, index, measure) for index, measure in enumerate(values)]
        for completed, future in enumerate(as_completed(futures), start=1):
            index, enriched = future.result()
            result[index] = enriched
            if completed % 20 == 0 or completed == len(values):
                LOG.info("federal details %s/%s", completed, len(values))
    return [measure for measure in result if measure is not None]
