from __future__ import annotations

import re
from datetime import date


DATE_RE = r"(\d{1,2}[.\-/]\d{1,2}[.\-/]20\d{2})"
WINDOW_RE = re.compile(
    rf"(?:при[её]м\w*\s+(?:заявок|заявлени\w*)|подач\w*\s+(?:заявок|заявлени\w*))"
    rf".{{0,120}}?\bс\s+{DATE_RE}.{{0,80}}?\bпо\s+{DATE_RE}",
    re.IGNORECASE | re.DOTALL,
)
DIRECT_WINDOW_RE = re.compile(
    rf"срок\s+при[её]ма\s+заявок\s+{DATE_RE}(?:\s+\d{{1,2}}:\d{{2}})?"
    rf"\s*[-–—]\s*{DATE_RE}", re.IGNORECASE,
)


def parse_date(value: str) -> date | None:
    try:
        day, month, year = [int(x) for x in re.split(r"[.\-/]", value)]
        return date(year, month, day)
    except (TypeError, ValueError):
        return None


def application_window(text: str) -> tuple[date | None, date | None]:
    match = DIRECT_WINDOW_RE.search(text[:40_000]) or WINDOW_RE.search(text[:40_000])
    if not match:
        return None, None
    start, end = parse_date(match.group(1)), parse_date(match.group(2))
    if not start or not end or end < start or (end - start).days > 370:
        return None, None
    return start, end
