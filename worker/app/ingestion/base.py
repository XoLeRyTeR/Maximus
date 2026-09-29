from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from urllib.parse import urljoin, urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


@dataclass(frozen=True)
class Document:
    url: str
    title: str
    text: str | None = None
    extraction_status: str = "not_fetched"


@dataclass(frozen=True)
class Measure:
    source: str
    source_url: str
    external_id: str
    title: str
    region: str | None
    kind: str  # measure or selection
    description: str = ""
    terms: str = ""
    amount: str | None = None
    published_at: date | None = None
    application_start: date | None = None
    application_deadline: date | None = None
    documents: tuple[Document, ...] = field(default_factory=tuple)


class Fetcher:
    def __init__(self, timeout: int = 25, max_bytes: int = 25_000_000):
        self.timeout = timeout
        self.max_bytes = max_bytes
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "AgrograntHackathon/0.1 (+public support catalog; contact via repository)"})
        retry = Retry(total=2, backoff_factor=0.6, status_forcelist=[429, 500, 502, 503, 504])
        self.session.mount("https://", HTTPAdapter(max_retries=retry))

    def get(self, url: str) -> tuple[bytes, str]:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in {"apk.ivanovoobl.ru", "svoefermerstvo.ru"}:
            raise ValueError(f"Unsupported source host: {parsed.hostname}")
        with self.session.get(url, timeout=self.timeout, stream=True) as response:
            response.raise_for_status()
            chunks = []
            size = 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > self.max_bytes:
                    raise ValueError(f"Source is larger than {self.max_bytes} bytes: {url}")
                chunks.append(chunk)
            return b"".join(chunks), response.headers.get("Content-Type", "")

    def html(self, url: str) -> str:
        data, content_type = self.get(url)
        if "html" not in content_type.lower():
            raise ValueError(f"Expected HTML at {url}, got {content_type}")
        return data.decode("utf-8", errors="replace")


def absolute(base: str, href: str) -> str:
    return urljoin(base, href.strip())


def clean(value: str) -> str:
    return " ".join(value.split())
