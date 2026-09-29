from __future__ import annotations

import logging
from urllib.parse import urlencode

from bs4 import BeautifulSoup

from .base import Fetcher, Measure, absolute, clean

URL = "https://svoefermerstvo.ru/mery-podderzhki"
LOG = logging.getLogger(__name__)


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
        text = clean(card.get_text(" ", strip=True))
        if text.startswith(title):
            text = text[len(title):].strip()
        measures.append(Measure(
            source="svoefermerstvo_federal", source_url=url, external_id=url,
            title=title, region=None, kind="measure", description=text[:16000],
        ))
    if not measures:
        raise ValueError("Federal catalog contained no support cards")
    return measures


def collect(fetcher: Fetcher, max_pages: int = 200) -> list[Measure]:
    html = fetcher.html(URL)
    first = parse(html)
    soup = BeautifulSoup(html, "html.parser")
    numbers = [int(a.get_text(" ", strip=True)) for a in soup.select(".theme-2-pagination--page") if a.get_text(" ", strip=True).isdigit()]
    total_pages = max(numbers, default=1)
    if total_pages > max_pages:
        raise ValueError(f"Federal catalog has {total_pages} pages, exceeding configured max_pages={max_pages}")
    measures = {m.external_id: m for m in first}
    for page in range(2, total_pages + 1):
        page_url = f"{URL}?{urlencode({'page': page})}"
        page_measures = parse(fetcher.html(page_url))
        for measure in page_measures:
            measures[measure.external_id] = measure
        if page % 20 == 0 or page == total_pages:
            LOG.info("federal catalog page %s/%s: %s unique measures", page, total_pages, len(measures))
    return list(measures.values())
